import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { JobMessage } from '@/lib/services/queue/type'
import {
  CreateQueueJobParams,
  GetDueQueueJobsParams,
  QueueJob,
  QueueJobDatabase,
  QueueJobStatus
} from '@/lib/types/database/operations'

export interface SQLQueueJob {
  id: string
  name: string
  payload: string | JobMessage
  attempts: number
  max_retries: number
  next_run_at: number | Date | string
  status: QueueJobStatus
  last_error_message: string | null
  last_error_stack: string | null
  created_at: number | Date | string
  updated_at: number | Date | string
}

export const toQueueJob = (row: SQLQueueJob): QueueJob => ({
  id: row.id,
  name: row.name,
  payload: getCompatibleJSON<JobMessage>(row.payload),
  attempts: row.attempts,
  maxRetries: row.max_retries,
  nextRunAt: getCompatibleTime(row.next_run_at),
  status: row.status,
  lastErrorMessage: row.last_error_message,
  lastErrorStack: row.last_error_stack,
  createdAt: getCompatibleTime(row.created_at),
  updatedAt: getCompatibleTime(row.updated_at)
})

export const QueueJobSQLDatabaseMixin = (database: Knex): QueueJobDatabase => ({
  async createQueueJob(params: CreateQueueJobParams) {
    const currentTime = new Date()
    const id = params.id || randomUUID()
    const name = params.name
    const attempts = params.attempts ?? 0
    const maxRetries = params.maxRetries ?? 16
    const nextRunAt = params.nextRunAt
      ? new Date(params.nextRunAt)
      : currentTime
    const status = params.status ?? 'pending'
    const lastErrorMessage = params.lastErrorMessage ?? null
    const lastErrorStack = params.lastErrorStack ?? null

    const row = {
      id,
      name,
      payload: JSON.stringify(params.payload),
      attempts,
      max_retries: maxRetries,
      next_run_at: nextRunAt,
      status,
      last_error_message: lastErrorMessage,
      last_error_stack: lastErrorStack,
      created_at: currentTime,
      updated_at: currentTime
    }

    await database('queue_jobs').insert(row)

    return {
      id,
      name,
      payload: params.payload,
      attempts,
      maxRetries,
      nextRunAt: nextRunAt.getTime(),
      status,
      lastErrorMessage,
      lastErrorStack,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }
  },

  async getDueQueueJobs(params: GetDueQueueJobsParams = {}) {
    const { limit = 50, now = new Date() } = params
    const rows = await database<SQLQueueJob>('queue_jobs')
      .where('status', 'pending')
      .where('next_run_at', '<=', now)
      .orderBy('next_run_at', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)

    return rows.map(toQueueJob)
  },

  async claimQueueJob(id: string) {
    const updatedAt = new Date()
    const updatedCount = await database('queue_jobs')
      .where({ id, status: 'pending' })
      .update({
        status: 'processing',
        updated_at: updatedAt
      })

    return updatedCount > 0
  },

  async completeQueueJob(id: string) {
    const updatedAt = new Date()
    const updatedCount = await database('queue_jobs').where({ id }).update({
      status: 'completed',
      updated_at: updatedAt
    })

    return updatedCount > 0
  },

  async scheduleQueueJobRetry({
    id,
    nextRunAt,
    attempts,
    error
  }: {
    id: string
    nextRunAt: Date | number
    attempts: number
    error?: Error | unknown
  }) {
    let lastErrorMessage: string | null = null
    let lastErrorStack: string | null = null

    if (error) {
      if (error instanceof Error) {
        lastErrorMessage = error.message
        lastErrorStack = error.stack ?? null
      } else {
        lastErrorMessage = String(error)
      }
    }

    const updatedAt = new Date()
    const updatedCount = await database('queue_jobs')
      .where({ id })
      .update({
        status: 'pending',
        next_run_at: new Date(nextRunAt),
        attempts,
        last_error_message: lastErrorMessage,
        last_error_stack: lastErrorStack,
        updated_at: updatedAt
      })

    return updatedCount > 0
  },

  async failQueueJob({
    id,
    attempts,
    error
  }: {
    id: string
    attempts?: number
    error?: Error | unknown
  }) {
    let lastErrorMessage: string | null = null
    let lastErrorStack: string | null = null

    if (error) {
      if (error instanceof Error) {
        lastErrorMessage = error.message
        lastErrorStack = error.stack ?? null
      } else {
        lastErrorMessage = String(error)
      }
    }

    const updatedAt = new Date()
    const updateData: Record<string, unknown> = {
      status: 'failed',
      last_error_message: lastErrorMessage,
      last_error_stack: lastErrorStack,
      updated_at: updatedAt
    }

    if (attempts !== undefined) {
      updateData.attempts = attempts
    }

    const updatedCount = await database('queue_jobs')
      .where({ id })
      .update(updateData)

    return updatedCount > 0
  },

  async getQueueJobById(id: string) {
    const row = await database<SQLQueueJob>('queue_jobs').where({ id }).first()

    if (!row) return null
    return toQueueJob(row)
  },

  async deleteQueueJob(id: string) {
    const deletedCount = await database('queue_jobs').where({ id }).delete()
    return deletedCount > 0
  },

  async countQueueJobs(params: { status?: QueueJobStatus } = {}) {
    let query = database('queue_jobs')
    if (params.status) {
      query = query.where('status', params.status)
    }
    const result = await query
      .count<{ count: string | number }>('id as count')
      .first()
    return parseInt(String(result?.count ?? '0'), 10)
  }
})
