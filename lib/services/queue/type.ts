import { JobMessage } from '@/lib/jobs'
import { Storage } from '@/lib/storage/types'

export interface Queue {
  publish(message: JobMessage): Promise<void>
  handle(message: JobMessage): Promise<void>
}

export type JobHandle = (storage: Storage, message: JobMessage) => Promise<void>
