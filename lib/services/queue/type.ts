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
  publish(message: JobMessage): Promise<void>
  handle(message: JobMessage): Promise<void>
}

export type JobHandle = (
  database: Database,
  message: JobMessage
) => Promise<void>
