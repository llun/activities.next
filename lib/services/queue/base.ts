import { SpanStatusCode } from '@opentelemetry/api'

import { getDatabase } from '@/lib/database'
import type { JobHandle } from '@/lib/jobs'
import { logger } from '@/lib/utils/logger'
import { withSpan } from '@/lib/utils/trace'

import { JobMessage } from './type'

export type JobRegistryLoader = () => Promise<Record<string, JobHandle>>

// Loaded on first job so a route that only publishes never loads every job.
// Under tsx/cjs (scripts) this `import()` stays native and cannot resolve the
// `@/` alias, so a runner that scripts start passes its own loader instead.
const loadJobRegistry: JobRegistryLoader = async () =>
  (await import('@/lib/jobs')).JOBS as Record<string, JobHandle>

export const defaultJobHandle =
  (queueName: string, loadJobs: JobRegistryLoader = loadJobRegistry) =>
  async (message: JobMessage) => {
    return withSpan(
      'queue',
      'handle',
      {
        queueName,
        jobName: String(message.name)
      },
      async (span) => {
        // Ids only: delivery jobs carry whole activities, private ones too.
        logger.debug(
          { messageId: message.id, jobName: String(message.name) },
          `${queueName} handle job`
        )
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

        const JOBS = await loadJobs()
        const jobName = String(message.name)
        const hasJob = Object.prototype.hasOwnProperty.call(JOBS, jobName)
        const job = hasJob ? JOBS[jobName] : undefined
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
