import type { Storage } from '@/lib/database/types'

export interface JobMessage {
  id: string
  name: string
  data: unknown
}

export interface Queue {
  publish(message: JobMessage): Promise<void>
  handle(message: JobMessage): Promise<void>
}

export type JobHandle = (storage: Storage, message: JobMessage) => Promise<void>
