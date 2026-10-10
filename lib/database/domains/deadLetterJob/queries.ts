import type { Selectable } from 'kysely'
import { randomUUID } from 'node:crypto'

import type {
  CreateDeadLetterJobParams,
  DeadLetterJob,
  DeadLetterJobStatus,
  GetDeadLetterJobsParams
} from '@/lib/database/domains/deadLetterJob/types'
import type { Db } from '@/lib/database/kysely'
import type { DeadLetterJobs } from '@/lib/database/kysely/db'
import type { JobMessage } from '@/lib/services/queue/type'

const COLUMNS = [
  'id',
  'job_name',
  'payload',
  'error_message',
  'error_stack',
  'attempts',
  'status',
  'created_at',
  'updated_at'
] as const

const toDeadLetterJob = (row: Selectable<DeadLetterJobs>): DeadLetterJob => ({
  id: row.id,
  jobName: row.job_name,
  payload: row.payload as JobMessage,
  errorMessage: row.error_message,
  errorStack: row.error_stack,
  attempts: row.attempts,
  status: row.status as DeadLetterJobStatus,
  // Nullable in the schema, but every writer sets them.
  createdAt: row.created_at ?? 0,
  updatedAt: row.updated_at ?? 0
})

const findDeadLetterJob = (db: Db, id: string) =>
  db
    .selectFrom('dead_letter_jobs')
    .select(COLUMNS)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()

export const createDeadLetterJob = async (
  db: Db,
  params: CreateDeadLetterJobParams
): Promise<DeadLetterJob> => {
  const currentTime = new Date()
  const id = params.id || randomUUID()
  const jobName = params.jobName || params.job_name || 'unknown'
  const errorMessage = params.errorMessage || params.error_message || ''
  const errorStack = params.errorStack ?? params.error_stack ?? null
  const attempts = params.attempts ?? 1
  const status = params.status ?? 'failed'
  const payload = JSON.stringify(params.payload)

  await db
    .insertInto('dead_letter_jobs')
    .values({
      id,
      job_name: jobName,
      payload,
      error_message: errorMessage,
      error_stack: errorStack,
      attempts,
      status,
      created_at: currentTime,
      updated_at: currentTime
    })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet({
        job_name: jobName,
        payload,
        error_message: errorMessage,
        error_stack: errorStack,
        attempts,
        status,
        updated_at: currentTime
      })
    )
    .execute()

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
}

export const getDeadLetterJobs = async (
  db: Db,
  params: GetDeadLetterJobsParams = {}
): Promise<DeadLetterJob[]> => {
  const { status, limit = 50, offset = 0 } = params
  let query = db.selectFrom('dead_letter_jobs').select(COLUMNS)
  if (status) {
    query = query.where('status', '=', status)
  }

  const rows = await query
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .offset(offset)
    .execute()
  return rows.map(toDeadLetterJob)
}

export const countDeadLetterJobs = async (
  db: Db,
  params: { status?: DeadLetterJobStatus } = {}
): Promise<number> => {
  let query = db
    .selectFrom('dead_letter_jobs')
    .select((eb) => eb.fn.count('id').as('count'))
  if (params.status) {
    query = query.where('status', '=', params.status)
  }
  // count() is an expression: SQLite reports it without a declared type.
  const result = await query.executeTakeFirst()
  return Number(result?.count ?? 0)
}

export const getDeadLetterJobById = async (
  db: Db,
  id: string
): Promise<DeadLetterJob | null> => {
  const row = await findDeadLetterJob(db, id)
  return row ? toDeadLetterJob(row) : null
}

export const updateDeadLetterJobStatus = async (
  db: Db,
  id: string,
  status: DeadLetterJobStatus
): Promise<DeadLetterJob | null> => {
  const { numUpdatedRows } = await db
    .updateTable('dead_letter_jobs')
    .set({ status, updated_at: new Date() })
    .where('id', '=', id)
    .executeTakeFirst()
  if (Number(numUpdatedRows) === 0) return null

  const updated = await findDeadLetterJob(db, id)
  return updated ? toDeadLetterJob(updated) : null
}

export const deleteDeadLetterJobs = async (
  db: Db,
  ids: string[]
): Promise<number> => {
  if (ids.length === 0) return 0
  const { numDeletedRows } = await db
    .deleteFrom('dead_letter_jobs')
    .where('id', 'in', ids)
    .executeTakeFirst()
  return Number(numDeletedRows)
}

export const deleteDeadLetterJobsByStatus = async (
  db: Db,
  status: DeadLetterJobStatus
): Promise<number> => {
  const { numDeletedRows } = await db
    .deleteFrom('dead_letter_jobs')
    .where('status', '=', status)
    .executeTakeFirst()
  return Number(numDeletedRows)
}

export const deleteAllDeadLetterJobs = async (db: Db): Promise<number> => {
  const { numDeletedRows } = await db
    .deleteFrom('dead_letter_jobs')
    .executeTakeFirst()
  return Number(numDeletedRows)
}

export const deadLetterJobQueries = {
  createDeadLetterJob,
  getDeadLetterJobs,
  countDeadLetterJobs,
  getDeadLetterJobById,
  updateDeadLetterJobStatus,
  deleteDeadLetterJobs,
  deleteDeadLetterJobsByStatus,
  deleteAllDeadLetterJobs
}
