import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { JobMessage } from '@/lib/services/queue/type'
import {
  ClaimQueueJobParams,
  ClaimedQueueJob,
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
  claim_token: string | null
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
  claimToken: row.claim_token ?? null,
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

    await database('queue_jobs')
      .insert(row)
      .onConflict('id')
      .merge({
        name,
        payload: JSON.stringify(params.payload),
        attempts,
        max_retries: maxRetries,
        next_run_at: nextRunAt,
        status,
        last_error_message: lastErrorMessage,
        last_error_stack: lastErrorStack,
        updated_at: currentTime
      })

    return {
      id,
      name,
      payload: params.payload,
      attempts,
      maxRetries,
      nextRunAt: nextRunAt.getTime(),
      status,
      claimToken: null,
      lastErrorMessage,
      lastErrorStack,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }
  },

  async getDueQueueJobs(params: GetDueQueueJobsParams = {}) {
    const { limit = 50, now = new Date(), stalledTimeoutMs } = params
    const rows = await database<SQLQueueJob>('queue_jobs')
      .where((builder) => {
        builder.where('status', 'pending').andWhere('next_run_at', '<=', now)
        if (typeof stalledTimeoutMs === 'number' && stalledTimeoutMs > 0) {
          const stalledBefore = new Date(now.getTime() - stalledTimeoutMs)
          builder.orWhere((b) => {
            b.where('status', 'processing').andWhere(
              'updated_at',
              '<=',
              stalledBefore
            )
          })
        }
      })
      .orderBy('next_run_at', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)

    return rows.map(toQueueJob)
  },

  async claimQueueJob({
    id,
    now = new Date(),
    stalledBefore
  }: ClaimQueueJobParams): Promise<ClaimedQueueJob | null> {
    const claimToken = randomUUID()
    const updatedAt = new Date()

    const updatedCount = await database('queue_jobs')
      .where('id', id)
      .where((builder) => {
        builder.where((b) => {
          b.where('status', 'pending').andWhere('next_run_at', '<=', now)
        })
        if (stalledBefore) {
          builder.orWhere((b) => {
            b.where('status', 'processing').andWhere(
              'updated_at',
              '<=',
              stalledBefore
            )
          })
        }
      })
      .update({
        status: 'processing',
        claim_token: claimToken,
        updated_at: updatedAt
      })

    if (updatedCount === 0) return null

    const row = await database<SQLQueueJob>('queue_jobs')
      .where({ id, claim_token: claimToken })
      .first()

    if (!row) return null

    return {
      ...toQueueJob(row),
      claimToken
    }
  },

  async completeQueueJob({
    id,
    claimToken
  }: {
    id: string
    claimToken: string
  }) {
    const updatedAt = new Date()
    const updatedCount = await database('queue_jobs')
      .where({ id, claim_token: claimToken, status: 'processing' })
      .update({
        status: 'completed',
        claim_token: null,
        updated_at: updatedAt
      })

    return updatedCount > 0
  },

  async scheduleQueueJobRetry({
    id,
    claimToken,
    nextRunAt,
    attempts,
    error
  }: {
    id: string
    claimToken: string
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
      .where({ id, claim_token: claimToken, status: 'processing' })
      .update({
        status: 'pending',
        claim_token: null,
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
    claimToken,
    attempts,
    error
  }: {
    id: string
    claimToken: string
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
      claim_token: null,
      last_error_message: lastErrorMessage,
      last_error_stack: lastErrorStack,
      updated_at: updatedAt
    }

    if (attempts !== undefined) {
      updateData.attempts = attempts
    }

    const updatedCount = await database('queue_jobs')
      .where({ id, claim_token: claimToken, status: 'processing' })
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
