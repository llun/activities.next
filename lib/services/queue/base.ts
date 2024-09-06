import { SpanStatusCode } from '@opentelemetry/api'

import { JOBS } from '@/lib/jobs'
import { getStorage } from '@/lib/storage'
import { logger } from '@/lib/utils/logger'
import { getTracer } from '@/lib/utils/trace'

import { JobMessage } from './type'

export const defaultJobHandle =
  (queueName: string) => async (message: JobMessage) => {
    await getTracer().startActiveSpan('queue.handle', async (span) => {
      logger.debug({ message }, `${queueName} handle job`)
      const storage = await getStorage()
      if (!storage) {
        logger.error('Storage is not available')
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'Storage is not available'
        })
        span.end()
        return
      }

      const job = JOBS[message.name]
      if (!job) {
        logger.error({ message }, 'Unknown job name')
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'Unkown job name'
        })
        span.end()
        return
      }

      await job(storage, message)
    })
  }
