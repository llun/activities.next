import { getConfig } from '@/lib/config'
import { getTracer } from '@/lib/utils/trace'

import { NoQueue } from './noqueue'
import { QStashQueue } from './qstash'
import { JobHandle } from './type'

export const getQueue = () => {
  const config = getConfig()
  switch (config.queue?.type) {
    case 'qstash': {
      return new QStashQueue(config.queue)
    }
    default: {
      return new NoQueue()
    }
  }
}

export const createJobHandle = (
  jobName: string,
  handle: JobHandle
): JobHandle => {
  return async (storage, message) => {
    await getTracer().startActiveSpan(
      'queue.handle',
      { attributes: { job: jobName } },
      async (span) => {
        await handle(storage, message)
        span.end()
      }
    )
  }
}
