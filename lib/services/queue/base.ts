import { SpanStatusCode } from '@opentelemetry/api'

import { getDatabase } from '@/lib/database'
import { JOBS } from '@/lib/jobs'
import { logger } from '@/lib/utils/logger'
import { getTracer } from '@/lib/utils/trace'

import { JobMessage } from './type'

export const defaultJobHandle =
  (queueName: string) => async (message: JobMessage) => {
    await getTracer().startActiveSpan('queue.handle', async (span) => {
      logger.debug({ message }, `${queueName} handle job`)
      const database = getDatabase()
      if (!database) {
        logger.error('Database is not available')
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'Database is not available'
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

      await job(database, message)
    })
  }
