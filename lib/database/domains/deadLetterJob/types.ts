// Parameter and result types of the dead letter job domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type { JobMessage } from '@/lib/services/queue/type'

export type DeadLetterJobStatus = 'failed' | 'retried' | 'discarded'

export interface DeadLetterJob {
  id: string
  jobName: string
  payload: JobMessage
  errorMessage: string
  errorStack?: string | null
  attempts: number
  status: DeadLetterJobStatus
  createdAt: number
  updatedAt: number
}

export interface CreateDeadLetterJobParams {
  id?: string
  jobName?: string
  job_name?: string
  payload: JobMessage
  errorMessage?: string
  error_message?: string
  errorStack?: string | null
  error_stack?: string | null
  attempts?: number
  status?: DeadLetterJobStatus
}

export interface GetDeadLetterJobsParams {
  status?: DeadLetterJobStatus
  limit?: number
  offset?: number
}

export interface DeadLetterJobDatabase {
  createDeadLetterJob(params: CreateDeadLetterJobParams): Promise<DeadLetterJob>
  getDeadLetterJobs(params?: GetDeadLetterJobsParams): Promise<DeadLetterJob[]>
  countDeadLetterJobs(params?: {
    status?: DeadLetterJobStatus
  }): Promise<number>
  getDeadLetterJobById(id: string): Promise<DeadLetterJob | null>
  updateDeadLetterJobStatus(
    id: string,
    status: DeadLetterJobStatus
  ): Promise<DeadLetterJob | null>
  deleteDeadLetterJobs(ids: string[]): Promise<number>
  deleteDeadLetterJobsByStatus(status: DeadLetterJobStatus): Promise<number>
  deleteAllDeadLetterJobs(): Promise<number>
}
