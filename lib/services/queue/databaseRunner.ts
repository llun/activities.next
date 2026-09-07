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
    const claimedJob = await database.claimQueueJob({
      id: job.id,
      now,
      stalledBefore
    })
    if (!claimedJob) {
      // Another worker/runner already claimed this job or it was rescheduled
      continue
    }

    await withSpan(
      'queue',
      'databaseRunner.processJob',
      {
        'job.id': claimedJob.id,
        'job.name': claimedJob.name
      },
      async (span) => {
        span.addEvent('job_claimed', {
          'job.id': claimedJob.id,
          'job.claim_token': claimedJob.claimToken
        })

        try {
          await handleJob(claimedJob.payload)
          const completed = await database.completeQueueJob({
            id: claimedJob.id,
            claimToken: claimedJob.claimToken
          })
          if (completed) {
            span.addEvent('job_completed', {
              'job.id': claimedJob.id,
              'job.attempts': claimedJob.attempts
            })
            processedCount++
          } else {
            span.addEvent('job_settlement_rejected_stale_claim', {
              'job.id': claimedJob.id,
              'job.action': 'complete'
            })
            logger.warn(
              {
                jobId: claimedJob.id,
                jobName: claimedJob.name,
                claimToken: claimedJob.claimToken
              },
              'Database queue job completion rejected: claim token is stale or superseded'
            )
          }
        } catch (error) {
          const err = toLoggableError(error)
          const nextAttempts = claimedJob.attempts + 1

          if (nextAttempts < claimedJob.maxRetries) {
            const delaySeconds = calculatePolynomialBackoffSeconds(
              nextAttempts,
              backoffOptions
            )
            const nextRunAt = new Date(Date.now() + delaySeconds * 1000)

            const retried = await database.scheduleQueueJobRetry({
              id: claimedJob.id,
              claimToken: claimedJob.claimToken,
              nextRunAt,
              attempts: nextAttempts,
              error: err
            })

            if (retried) {
              span.addEvent('job_retry_scheduled', {
                'job.id': claimedJob.id,
                'job.attempts': nextAttempts,
                'job.delay_seconds': delaySeconds,
                'job.next_run_at': nextRunAt.toISOString(),
                'error.message': err.message
              })

              logger.warn(
                {
                  jobId: claimedJob.id,
                  jobName: claimedJob.name,
                  attempts: nextAttempts,
                  nextRunAt,
                  err
                },
                'Database queue job failed, retry scheduled'
              )
              processedCount++
            } else {
              span.addEvent('job_settlement_rejected_stale_claim', {
                'job.id': claimedJob.id,
                'job.action': 'retry'
              })
              logger.warn(
                {
                  jobId: claimedJob.id,
                  jobName: claimedJob.name,
                  claimToken: claimedJob.claimToken,
                  err
                },
                'Database queue job retry rejected: claim token is stale or superseded'
              )
            }
          } else {
            const failed = await database.failQueueJob({
              id: claimedJob.id,
              claimToken: claimedJob.claimToken,
              attempts: nextAttempts,
              error: err
            })

            if (failed) {
              await database.createDeadLetterJob({
                id: claimedJob.id,
                jobName: claimedJob.name,
                payload: claimedJob.payload,
                errorMessage: err.message,
                errorStack: err.stack ?? null,
                attempts: nextAttempts,
                status: 'failed'
              })

              span.addEvent('job_terminal_failure', {
                'job.id': claimedJob.id,
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
                  jobId: claimedJob.id,
                  jobName: claimedJob.name,
                  attempts: nextAttempts,
                  err
                },
                'Database queue job failed terminally, captured in dead_letter_jobs'
              )
              processedCount++
            } else {
              span.addEvent('job_settlement_rejected_stale_claim', {
                'job.id': claimedJob.id,
                'job.action': 'fail'
              })
              logger.warn(
                {
                  jobId: claimedJob.id,
                  jobName: claimedJob.name,
                  claimToken: claimedJob.claimToken,
                  err
                },
                'Database queue job terminal failure rejected: claim token is stale or superseded'
              )
            }
          }
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
