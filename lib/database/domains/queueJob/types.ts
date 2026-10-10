// Parameter and result types of the queue job domain (the transactional
// outbox). lib/types/database/operations.ts re-exports them, so existing
// imports keep working.
import type { JobMessage } from '@/lib/services/queue/type'

export type QueueJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface QueueJob {
  id: string
  name: string
  payload: JobMessage
  attempts: number
  maxRetries: number
  nextRunAt: number
  status: QueueJobStatus
  claimToken?: string | null
  lastErrorMessage?: string | null
  lastErrorStack?: string | null
  createdAt: number
  updatedAt: number
}

export interface ClaimedQueueJob extends QueueJob {
  claimToken: string
}

export interface CreateQueueJobParams {
  id?: string
  name: string
  payload: JobMessage
  attempts?: number
  maxRetries?: number
  nextRunAt?: number | Date
  status?: QueueJobStatus
  lastErrorMessage?: string | null
  lastErrorStack?: string | null
}

export interface GetDueQueueJobsParams {
  limit?: number
  now?: Date
  stalledTimeoutMs?: number
}

export interface ClaimQueueJobParams {
  id: string
  now?: Date
  stalledBefore?: Date
}

export interface FailQueueJobWithDeadLetterParams {
  id: string
  claimToken: string
  attempts?: number
  error?: Error | unknown
}

export interface ReplayQueueJobParams {
  id: string
}

export interface QueueJobDatabase {
  createQueueJob(params: CreateQueueJobParams): Promise<QueueJob>
  getDueQueueJobs(params?: GetDueQueueJobsParams): Promise<QueueJob[]>
  claimQueueJob(params: ClaimQueueJobParams): Promise<ClaimedQueueJob | null>
  completeQueueJob(params: { id: string; claimToken: string }): Promise<boolean>
  scheduleQueueJobRetry(params: {
    id: string
    claimToken: string
    nextRunAt: Date | number
    attempts: number
    error?: Error | unknown
  }): Promise<boolean>
  failQueueJobWithDeadLetter(
    params: FailQueueJobWithDeadLetterParams
  ): Promise<boolean>
  replayQueueJob(params: ReplayQueueJobParams): Promise<boolean>
  /**
   * Deletes up to `limit` `completed` jobs last updated before `olderThan` and
   * returns how many were removed. Completed rows keep their full payload and
   * are otherwise never reaped, so without this the table only grows.
   */
  purgeCompletedQueueJobs(params: {
    olderThan: Date
    limit?: number
  }): Promise<number>
}
