import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { JobMessage } from '@/lib/services/queue/type'
import {
  CreateDeadLetterJobParams,
  DeadLetterJob,
  DeadLetterJobDatabase,
  DeadLetterJobStatus,
  GetDeadLetterJobsParams
} from '@/lib/types/database/operations'

export interface SQLDeadLetterJob {
  id: string
  job_name: string
  payload: string | JobMessage
  error_message: string
  error_stack: string | null
  attempts: number
  status: DeadLetterJobStatus
  created_at: number | Date | string
  updated_at: number | Date | string
}

export const toDeadLetterJob = (row: SQLDeadLetterJob): DeadLetterJob => ({
  id: row.id,
  jobName: row.job_name,
  payload: getCompatibleJSON<JobMessage>(row.payload),
  errorMessage: row.error_message,
  errorStack: row.error_stack,
  attempts: row.attempts,
  status: row.status,
  createdAt: getCompatibleTime(row.created_at),
  updatedAt: getCompatibleTime(row.updated_at)
})

export const DeadLetterJobSQLDatabaseMixin = (
  database: Knex
): DeadLetterJobDatabase => ({
  async createDeadLetterJob(params: CreateDeadLetterJobParams) {
    const currentTime = new Date()
    const id = params.id || randomUUID()
    const jobName = params.jobName || params.job_name || 'unknown'
    const errorMessage = params.errorMessage || params.error_message || ''
    const errorStack = params.errorStack ?? params.error_stack ?? null
    const attempts = params.attempts ?? 1
    const status = params.status ?? 'failed'

    const row = {
      id,
      job_name: jobName,
      payload: JSON.stringify(params.payload),
      error_message: errorMessage,
      error_stack: errorStack,
      attempts,
      status,
      created_at: currentTime,
      updated_at: currentTime
    }

    await database('dead_letter_jobs')
      .insert(row)
      .onConflict('id')
      .merge({
        job_name: jobName,
        payload: JSON.stringify(params.payload),
        error_message: errorMessage,
        error_stack: errorStack,
        attempts,
        status,
        updated_at: currentTime
      })

    return {
      id,
      jobName,
      payload: params.payload,
      errorMessage,
      errorStack,
      attempts,
      status,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }
  },

  async getDeadLetterJobs(params: GetDeadLetterJobsParams = {}) {
    const { status, limit = 50, offset = 0 } = params
    let query = database<SQLDeadLetterJob>('dead_letter_jobs')

    if (status) {
      query = query.where('status', status)
    }

    const rows = await query
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset)

    return rows.map(toDeadLetterJob)
  },

  async countDeadLetterJobs(params: { status?: DeadLetterJobStatus } = {}) {
    let query = database('dead_letter_jobs')
    if (params.status) {
      query = query.where('status', params.status)
    }
    const result = await query
      .count<{ count: string | number }>('id as count')
      .first()
    return parseInt(String(result?.count ?? '0'), 10)
  },

  async getDeadLetterJobById(id: string) {
    const row = await database<SQLDeadLetterJob>('dead_letter_jobs')
      .where({ id })
      .first()

    if (!row) return null
    return toDeadLetterJob(row)
  },

  async updateDeadLetterJobStatus(id: string, status: DeadLetterJobStatus) {
    const updatedAt = new Date()
    const count = await database('dead_letter_jobs').where({ id }).update({
      status,
      updated_at: updatedAt
    })

    if (count === 0) return null

    const updated = await database<SQLDeadLetterJob>('dead_letter_jobs')
      .where({ id })
      .first()

    return updated ? toDeadLetterJob(updated) : null
  },

  async deleteDeadLetterJob(id: string) {
    const count = await database('dead_letter_jobs').where({ id }).delete()
    return count > 0
  },

  async deleteDeadLetterJobs(ids: string[]) {
    if (ids.length === 0) return 0
    return await database('dead_letter_jobs').whereIn('id', ids).delete()
  },

  async deleteDeadLetterJobsByStatus(status: DeadLetterJobStatus) {
    return await database('dead_letter_jobs').where({ status }).delete()
  },

  async deleteAllDeadLetterJobs() {
    return await database('dead_letter_jobs').delete()
  }
})
