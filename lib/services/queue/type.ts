import type { Database } from '@/lib/database/types'

export interface JobMessage {
  id: string
  name: string
  data: unknown
  verifiedSenderActorId?: string
  // Optional publish delay in seconds. QStash honors this natively; the
  // in-process NoQueue has no scheduler and DROPS any message with a positive
  // delaySeconds, so delayed jobs (e.g. scheduled statuses) only fire under a
  // real queue like QStash.
  delaySeconds?: number
}

export interface Queue {
  // True when `publish` runs the job handler in-process and synchronously
  // (NoQueue), so awaiting `publish` blocks the caller until the job finishes.
  // False for real brokers (e.g. QStash) where `publish` only enqueues and the
  // job runs out of band. Callers that await `publish` during a request can use
  // this to keep the inline work small.
  readonly runsInline: boolean
  publish(message: JobMessage): Promise<void>
  handle(message: JobMessage): Promise<void>
}

export type JobHandle = (
  database: Database,
  message: JobMessage
) => Promise<void>
