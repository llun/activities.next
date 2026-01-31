import type { Database } from '@/lib/database/types'

export interface JobMessage {
  id: string
  name: string
  data: unknown
}

export interface Queue {
  publish(message: JobMessage): Promise<void>
  publishDelayed?(message: JobMessage, delay: number): Promise<void>
  handle(message: JobMessage): Promise<void>
}

export type JobHandle = (
  database: Database,
  message: JobMessage
) => Promise<void>
