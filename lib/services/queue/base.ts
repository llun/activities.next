import { SpanStatusCode } from '@opentelemetry/api'

import { getDatabase } from '@/lib/database'
import { JOBS, JobHandle } from '@/lib/jobs'
import { logger } from '@/lib/utils/logger'
import { withSpan } from '@/lib/utils/trace'

import { JobMessage } from './type'

export const defaultJobHandle =
  (queueName: string) => async (message: JobMessage) => {
    return withSpan(
      'queue',
      'handle',
      {
        queueName,
        jobName: String(message.name)
      },
      async (span) => {
        logger.debug({ message }, `${queueName} handle job`)
        const database = getDatabase()
        if (!database) {
          logger.error('Database is not available')
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: 'Database is not available'
          })
          span.recordException(new Error('Database is not available'))
          return
        }

        const jobName = String(message.name)
        const hasJob = Object.prototype.hasOwnProperty.call(JOBS, jobName)
        const job = hasJob
          ? (JOBS as Record<string, JobHandle>)[jobName]
          : undefined
        if (!hasJob || typeof job !== 'function') {
          logger.error({ message }, 'Unknown job name')
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: 'Unknown job name'
          })
          span.recordException(new Error('Unknown job name'))
          return
        }

        await job(database, message)
      }
    )
  }
