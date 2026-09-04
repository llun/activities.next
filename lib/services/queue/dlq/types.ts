import {
  DeadLetterJob,
  DeadLetterJobStatus
} from '@/lib/types/database/operations'

export type DLQJobItem = DeadLetterJob

export interface GetDLQJobsParams {
  status?: DeadLetterJobStatus
  limit?: number
  offset?: number
}

export interface GetDLQJobsResult {
  jobs: DLQJobItem[]
  total: number
  counts: {
    all: number
    failed: number
    retried: number
    discarded: number
  }
}

export interface DLQActionResult {
  success: boolean
  count?: number
  error?: string
}

export interface DLQProvider {
  readonly type: 'database' | 'qstash'
  getJobs(params?: GetDLQJobsParams): Promise<GetDLQJobsResult>
  retryJob(id: string): Promise<DLQActionResult>
  discardJob(id: string): Promise<DLQActionResult>
  retryAll(): Promise<DLQActionResult>
  clearDiscarded(): Promise<DLQActionResult>
}
