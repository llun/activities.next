import type { Selectable } from 'kysely'
import { randomUUID } from 'node:crypto'

import type {
  ClaimQueueJobParams,
  ClaimedQueueJob,
  CreateQueueJobParams,
  FailQueueJobWithDeadLetterParams,
  GetDueQueueJobsParams,
  QueueJob,
  QueueJobStatus,
  ReplayQueueJobParams
} from '@/lib/database/domains/queueJob/types'
import { type Db, inTransaction, isInTransaction } from '@/lib/database/kysely'
import type { QueueJobs } from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import type { JobMessage } from '@/lib/services/queue/type'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

const COLUMNS = [
  'id',
  'name',
  'payload',
  'attempts',
  'max_retries',
  'next_run_at',
  'status',
  'claim_token',
  'last_error_message',
  'last_error_stack',
  'created_at',
  'updated_at'
] as const

const toQueueJob = (row: Selectable<QueueJobs>): QueueJob => ({
  id: row.id,
  name: row.name,
  payload: row.payload as JobMessage,
  attempts: row.attempts,
  maxRetries: row.max_retries,
  nextRunAt: row.next_run_at,
  status: row.status as QueueJobStatus,
  claimToken: row.claim_token ?? null,
  lastErrorMessage: row.last_error_message,
  lastErrorStack: row.last_error_stack,
  // Nullable in the schema, but every writer sets them.
  createdAt: row.created_at ?? 0,
  updatedAt: row.updated_at ?? 0
})

const findQueueJob = (db: Db, id: string) =>
  db
    .selectFrom('queue_jobs')
    .select(COLUMNS)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()

export const createQueueJob = async (
  db: Db,
  params: CreateQueueJobParams
): Promise<QueueJob> => {
  const currentTime = new Date()
  const id = params.id || randomUUID()
  const name = params.name
  const attempts = params.attempts ?? 0
  const maxRetries = params.maxRetries ?? 16
  const nextRunAt = params.nextRunAt ? new Date(params.nextRunAt) : currentTime
  const status = params.status ?? 'pending'
  const lastErrorMessage = params.lastErrorMessage ?? null
  const lastErrorStack = params.lastErrorStack ?? null

  await db
    .insertInto('queue_jobs')
    .values({
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
    })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute()

  const persisted = await findQueueJob(db, id)
  if (!persisted) {
    throw new Error(`Failed to persist or fetch queue job: ${id}`)
  }
  // A conflicting id is a duplicate delivery of the SAME job only when the
  // existing row is that job. A row of another kind under this id means two
  // producers derived one key — returning it as success silently dropped the
  // new job (a remote activity pre-reserving a local delete's fan-out key),
  // so fail loudly instead.
  if (persisted.name !== name) {
    throw new Error(
      `Queue job id ${id} is already taken by a ${persisted.name} job, refusing to treat a ${name} job as its duplicate`
    )
  }

  return toQueueJob(persisted)
}

export const getDueQueueJobs = async (
  db: Db,
  params: GetDueQueueJobsParams = {}
): Promise<QueueJob[]> => {
  const { limit = 50, now = new Date(), stalledTimeoutMs } = params
  const rows = await db
    .selectFrom('queue_jobs')
    .select(COLUMNS)
    .where((eb) => {
      const due = eb.and([
        eb('status', '=', 'pending'),
        eb('next_run_at', '<=', timestampValue(now))
      ])
      if (typeof stalledTimeoutMs !== 'number' || stalledTimeoutMs <= 0) {
        return due
      }
      const stalledBefore = new Date(now.getTime() - stalledTimeoutMs)
      return eb.or([
        due,
        eb.and([
          eb('status', '=', 'processing'),
          eb('updated_at', '<=', timestampValue(stalledBefore))
        ])
      ])
    })
    .orderBy('next_run_at', 'asc')
    .orderBy('id', 'asc')
    .limit(limit)
    .execute()
  return rows.map(toQueueJob)
}

// Compare-and-swap: one UPDATE that only matches a row that is still claimable
// (pending and due, or processing and stalled), so of several workers racing
// for the same job exactly one gets a changed row. The claim token written by
// the winner is what the follow-up read, complete and retry calls check.
export const claimQueueJob = async (
  db: Db,
  { id, now = new Date(), stalledBefore }: ClaimQueueJobParams
): Promise<ClaimedQueueJob | null> => {
  const claimToken = randomUUID()
  const updatedAt = new Date()

  const { numUpdatedRows } = await db
    .updateTable('queue_jobs')
    .set({
      status: 'processing',
      claim_token: claimToken,
      updated_at: updatedAt
    })
    .where('id', '=', id)
    .where((eb) => {
      const pendingAndDue = eb.and([
        eb('status', '=', 'pending'),
        eb('next_run_at', '<=', timestampValue(now))
      ])
      if (!stalledBefore) return pendingAndDue
      return eb.or([
        pendingAndDue,
        eb.and([
          eb('status', '=', 'processing'),
          eb('updated_at', '<=', timestampValue(stalledBefore))
        ])
      ])
    })
    .executeTakeFirst()
  if (Number(numUpdatedRows) === 0) return null

  const row = await db
    .selectFrom('queue_jobs')
    .select(COLUMNS)
    .where('id', '=', id)
    .where('claim_token', '=', claimToken)
    .limit(1)
    .executeTakeFirst()
  if (!row) return null

  return { ...toQueueJob(row), claimToken }
}

export const completeQueueJob = async (
  db: Db,
  { id, claimToken }: { id: string; claimToken: string }
): Promise<boolean> => {
  const { numUpdatedRows } = await db
    .updateTable('queue_jobs')
    .set({ status: 'completed', claim_token: null, updated_at: new Date() })
    .where('id', '=', id)
    .where('claim_token', '=', claimToken)
    .where('status', '=', 'processing')
    .executeTakeFirst()
  return Number(numUpdatedRows) > 0
}

export const scheduleQueueJobRetry = async (
  db: Db,
  {
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
  }
): Promise<boolean> => {
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

  const { numUpdatedRows } = await db
    .updateTable('queue_jobs')
    .set({
      status: 'pending',
      claim_token: null,
      next_run_at: new Date(nextRunAt),
      attempts,
      last_error_message: lastErrorMessage,
      last_error_stack: lastErrorStack,
      updated_at: new Date()
    })
    .where('id', '=', id)
    .where('claim_token', '=', claimToken)
    .where('status', '=', 'processing')
    .executeTakeFirst()
  return Number(numUpdatedRows) > 0
}

// Marks a claimed job failed and records it in the dead letter table in one
// transaction: either both happen or neither does.
export const failQueueJobWithDeadLetter = (
  db: Db,
  { id, claimToken, attempts, error }: FailQueueJobWithDeadLetterParams
): Promise<boolean> =>
  inTransaction(db, async (trx) => {
    const job = await trx
      .selectFrom('queue_jobs')
      .select(COLUMNS)
      .where('id', '=', id)
      .where('claim_token', '=', claimToken)
      .where('status', '=', 'processing')
      .limit(1)
      .executeTakeFirst()
    if (!job) return false

    let lastErrorMessage: string | null = null
    let lastErrorStack: string | null = null

    if (error !== undefined) {
      if (error instanceof Error) {
        lastErrorMessage = error.message
        lastErrorStack = error.stack ?? null
      } else if (error !== null) {
        lastErrorMessage = String(error)
      }
    } else {
      lastErrorMessage = job.last_error_message
      lastErrorStack = job.last_error_stack
    }

    const updatedAt = new Date()
    const finalAttempts = attempts !== undefined ? attempts : job.attempts

    // The job still has to be the claimed, processing row when this runs: a
    // stale worker whose claim was taken over matches nothing and changes
    // nothing.
    const { numUpdatedRows } = await trx
      .updateTable('queue_jobs')
      .set({
        status: 'failed',
        claim_token: null,
        last_error_message: lastErrorMessage,
        last_error_stack: lastErrorStack,
        updated_at: updatedAt,
        ...(attempts !== undefined ? { attempts } : {})
      })
      .where('id', '=', id)
      .where('claim_token', '=', claimToken)
      .where('status', '=', 'processing')
      .executeTakeFirst()
    if (Number(numUpdatedRows) === 0) return false

    // The payload is a parsed JSON value. Text that is not JSON (hand-written
    // rows) comes back as a string and is kept under `raw`.
    let payload: string
    if (typeof job.payload === 'string') {
      try {
        payload = JSON.stringify(JSON.parse(job.payload))
      } catch {
        payload = JSON.stringify({ raw: job.payload })
      }
    } else {
      payload = JSON.stringify(job.payload)
    }
    const errorMessage =
      lastErrorMessage ||
      job.last_error_message ||
      'Job execution failed terminally'

    await trx
      .insertInto('dead_letter_jobs')
      .values({
        id: job.id,
        job_name: job.name,
        payload,
        error_message: errorMessage,
        error_stack: lastErrorStack,
        attempts: finalAttempts,
        status: 'failed',
        created_at: updatedAt,
        updated_at: updatedAt
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          job_name: job.name,
          payload,
          error_message: errorMessage,
          error_stack: lastErrorStack,
          attempts: finalAttempts,
          status: 'failed',
          updated_at: updatedAt
        })
      )
      .execute()

    return true
  })

// Puts a dead-lettered job back on the queue. The dead letter row and the
// queue row change in one transaction; a dead letter row without a failed
// queue row rolls back and reports false. Inside a caller's transaction the
// error is rethrown instead, so the caller's transaction rolls back unless it
// swallows the error.
export const replayQueueJob = async (
  db: Db,
  { id }: ReplayQueueJobParams
): Promise<boolean> => {
  try {
    return await inTransaction(db, async (trx) => {
      const { numUpdatedRows: updatedDlq } = await trx
        .updateTable('dead_letter_jobs')
        .set({ status: 'retried', updated_at: new Date() })
        .where('id', '=', id)
        .where('status', '=', 'failed')
        .executeTakeFirst()
      if (Number(updatedDlq) === 0) return false

      const { numUpdatedRows: updatedJob } = await trx
        .updateTable('queue_jobs')
        .set({
          status: 'pending',
          attempts: 0,
          next_run_at: new Date(),
          claim_token: null,
          last_error_message: null,
          last_error_stack: null,
          updated_at: new Date()
        })
        .where('id', '=', id)
        .where('status', '=', 'failed')
        .executeTakeFirst()
      if (Number(updatedJob) === 0) {
        throw new Error(
          `Cannot replay queue job ${id}: job not found or not in failed state in queue_jobs`
        )
      }

      return true
    })
  } catch (error) {
    if (isInTransaction(db)) throw error
    logger.error({
      err: toLoggableError(error),
      jobId: id,
      message: 'Failed to replay queue job'
    })
    return false
  }
}

export const purgeCompletedQueueJobs = async (
  db: Db,
  {
    olderThan,
    limit = 500
  }: {
    olderThan: Date
    limit?: number
  }
): Promise<number> => {
  // Picks the ids first, then deletes them by id and re-checks the status, so
  // a job replayed in between survives. `next_run_at` is repeated so the
  // (status, next_run_at) index bounds the scan; a job always completes after
  // it became due, so it never excludes a row `updated_at` would keep.
  const rows = await db
    .selectFrom('queue_jobs')
    .select('id')
    .where('status', '=', 'completed')
    .where('next_run_at', '<', timestampValue(olderThan))
    .where('updated_at', '<', timestampValue(olderThan))
    .orderBy('next_run_at', 'asc')
    .limit(limit)
    .execute()
  if (rows.length === 0) return 0

  const { numDeletedRows } = await db
    .deleteFrom('queue_jobs')
    .where(
      'id',
      'in',
      rows.map((row) => row.id)
    )
    .where('status', '=', 'completed')
    .executeTakeFirst()
  return Number(numDeletedRows)
}

export const queueJobQueries = {
  createQueueJob,
  getDueQueueJobs,
  claimQueueJob,
  completeQueueJob,
  scheduleQueueJobRetry,
  failQueueJobWithDeadLetter,
  replayQueueJob,
  purgeCompletedQueueJobs
}
