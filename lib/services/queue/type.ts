import type { Storage } from '@/lib/storage/types'

export interface JobMessage<T> {
  id: string
  name: string
  data: T
}

export interface Queue {
  publish<T>(message: JobMessage<T>): Promise<void>
  handle<T>(message: JobMessage<T>): Promise<void>
}

export type JobHandle = <T>(
  storage: Storage,
  message: JobMessage<T>
) => Promise<void>
