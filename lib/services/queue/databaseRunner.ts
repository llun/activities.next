import { SpanStatusCode } from '@opentelemetry/api'

import { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

import { defaultJobHandle } from './base'
import { BackoffOptions, calculatePolynomialBackoffSeconds } from './retry'
import { JobMessage } from './type'

export interface ProcessDueQueueJobsOptions {
  limit?: number
  now?: Date
  handleJob?: (message: JobMessage) => Promise<void>
  backoffOptions?: BackoffOptions
  stalledTimeoutMs?: number
}

export interface QueueRunnerOptions extends ProcessDueQueueJobsOptions {
  pollIntervalMs?: number
  batchSize?: number
}

export const processDueQueueJobs = async (
  database: Database,
  options: ProcessDueQueueJobsOptions = {}
): Promise<number> => {
  const {
    limit = 50,
    now = new Date(),
    handleJob = defaultJobHandle('database'),
    backoffOptions,
    stalledTimeoutMs = 15 * 60 * 1000
  } = options

  const stalledBefore =
    typeof stalledTimeoutMs === 'number' && stalledTimeoutMs > 0
      ? new Date(now.getTime() - stalledTimeoutMs)
      : undefined

  const dueJobs = await database.getDueQueueJobs({
    limit,
    now,
    stalledTimeoutMs
  })
  let processedCount = 0

  for (const job of dueJobs) {
    const claimed = await database.claimQueueJob(job.id, stalledBefore)
    if (!claimed) {
      // Another worker/runner already claimed this job
      continue
    }

    await withSpan(
      'queue',
      'databaseRunner.processJob',
      {
        'job.id': job.id,
        'job.name': job.name
      },
      async (span) => {
        span.addEvent('job_claimed', { 'job.id': job.id })

        try {
          await handleJob(job.payload)
          await database.completeQueueJob(job.id)
          span.addEvent('job_completed', {
            'job.id': job.id,
            'job.attempts': job.attempts
          })
          processedCount++
        } catch (error) {
          const err = toLoggableError(error)
          const nextAttempts = job.attempts + 1

          if (nextAttempts < job.maxRetries) {
            const delaySeconds = calculatePolynomialBackoffSeconds(
              nextAttempts,
              backoffOptions
            )
            const nextRunAt = new Date(Date.now() + delaySeconds * 1000)

            await database.scheduleQueueJobRetry({
              id: job.id,
              nextRunAt,
              attempts: nextAttempts,
              error: err
            })

            span.addEvent('job_retry_scheduled', {
              'job.id': job.id,
              'job.attempts': nextAttempts,
              'job.delay_seconds': delaySeconds,
              'job.next_run_at': nextRunAt.toISOString(),
              'error.message': err.message
            })

            logger.warn(
              {
                jobId: job.id,
                jobName: job.name,
                attempts: nextAttempts,
                nextRunAt,
                err
              },
              'Database queue job failed, retry scheduled'
            )
          } else {
            await database.failQueueJob({
              id: job.id,
              attempts: nextAttempts,
              error: err
            })

            await database.createDeadLetterJob({
              id: job.id,
              jobName: job.name,
              payload: job.payload,
              errorMessage: err.message,
              errorStack: err.stack ?? null,
              attempts: nextAttempts,
              status: 'failed'
            })

            span.addEvent('job_terminal_failure', {
              'job.id': job.id,
              'job.attempts': nextAttempts,
              'error.message': err.message
            })
            span.recordException(err)
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err.message
            })

            logger.error(
              {
                jobId: job.id,
                jobName: job.name,
                attempts: nextAttempts,
                err
              },
              'Database queue job failed terminally, captured in dead_letter_jobs'
            )
          }
          processedCount++
        }
      }
    )
  }

  return processedCount
}

export interface DatabaseQueueRunnerHandle {
  stop: () => void
}

export const startDatabaseQueueRunner = (
  database: Database,
  options: QueueRunnerOptions = {}
): DatabaseQueueRunnerHandle => {
  const {
    pollIntervalMs = 1000,
    batchSize = 10,
    handleJob,
    backoffOptions,
    stalledTimeoutMs
  } = options

  let running = true
  let timeoutId: NodeJS.Timeout | null = null

  const tick = async () => {
    if (!running) return

    try {
      const processed = await processDueQueueJobs(database, {
        limit: batchSize,
        handleJob,
        backoffOptions,
        stalledTimeoutMs
      })
      // If we processed a batch that filled the limit, tick sooner to drain backlog
      const nextDelay = processed >= batchSize ? 50 : pollIntervalMs
      if (running) {
        timeoutId = setTimeout(tick, nextDelay)
      }
    } catch (error) {
      const err = toLoggableError(error)
      logger.error({ err }, 'Unexpected error in database queue runner loop')
      if (running) {
        timeoutId = setTimeout(tick, pollIntervalMs)
      }
    }
  }

  timeoutId = setTimeout(tick, 0)

  return {
    stop: () => {
      running = false
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    }
  }
}
