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
  signal?: AbortSignal
  shouldStop?: () => boolean
}

export interface QueueRunnerOptions extends ProcessDueQueueJobsOptions {
  pollIntervalMs?: number
  batchSize?: number
  /** How long a `completed` job (and its payload) is kept. Default 7 days. */
  completedRetentionMs?: number
  /** Minimum gap between retention sweeps. Default 10 minutes. */
  retentionSweepIntervalMs?: number
}

export const DEFAULT_COMPLETED_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const DEFAULT_RETENTION_SWEEP_INTERVAL_MS = 10 * 60 * 1000
const RETENTION_SWEEP_BATCH_SIZE = 500
// Bounds one sweep so a huge backlog cannot starve job processing; the next
// sweep carries on where this one stopped.
const RETENTION_SWEEP_MAX_BATCHES = 100

/**
 * Deletes `completed` jobs older than the retention window in small batches.
 * A completed row's id keeps deduplicating a re-publish of the same id, so the
 * window is also the dedup window.
 */
export const purgeExpiredCompletedQueueJobs = async (
  database: Database,
  {
    now = new Date(),
    retentionMs = DEFAULT_COMPLETED_JOB_RETENTION_MS,
    shouldStop
  }: { now?: Date; retentionMs?: number; shouldStop?: () => boolean } = {}
): Promise<number> => {
  const olderThan = new Date(now.getTime() - retentionMs)
  let purged = 0
  for (let batch = 0; batch < RETENTION_SWEEP_MAX_BATCHES; batch++) {
    if (shouldStop?.()) break
    const deleted = await database.purgeCompletedQueueJobs({
      olderThan,
      limit: RETENTION_SWEEP_BATCH_SIZE
    })
    purged += deleted
    if (deleted < RETENTION_SWEEP_BATCH_SIZE) break
  }
  return purged
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
    if (options.shouldStop?.() || options.signal?.aborted) {
      break
    }

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
            const failed = await database.failQueueJobWithDeadLetter({
              id: claimedJob.id,
              claimToken: claimedJob.claimToken,
              attempts: nextAttempts,
              error: err
            })

            if (failed) {
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
  stop: (timeoutMs?: number) => Promise<void>
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
    stalledTimeoutMs,
    completedRetentionMs = DEFAULT_COMPLETED_JOB_RETENTION_MS,
    retentionSweepIntervalMs = DEFAULT_RETENTION_SWEEP_INTERVAL_MS
  } = options

  let lastRetentionSweepAt = 0
  const sweepRetention = async () => {
    const now = Date.now()
    if (now - lastRetentionSweepAt < retentionSweepIntervalMs) return
    lastRetentionSweepAt = now
    try {
      const purged = await purgeExpiredCompletedQueueJobs(database, {
        now: new Date(now),
        retentionMs: completedRetentionMs,
        shouldStop: () => !running
      })
      if (purged > 0) {
        logger.info({ purged }, 'Purged expired completed database queue jobs')
      }
    } catch (error) {
      // Housekeeping must never stop job processing.
      logger.error(
        { err: toLoggableError(error) },
        'Failed to purge expired completed database queue jobs'
      )
    }
  }

  let running = true
  let timeoutId: NodeJS.Timeout | null = null
  let activeTickPromise: Promise<void> | null = null

  const tick = async () => {
    if (!running) return

    await sweepRetention()

    try {
      const processed = await processDueQueueJobs(database, {
        limit: batchSize,
        handleJob,
        backoffOptions,
        stalledTimeoutMs,
        shouldStop: () => !running
      })
      // If we processed a batch that filled the limit, tick sooner to drain backlog
      const nextDelay = processed >= batchSize ? 50 : pollIntervalMs
      if (running) {
        scheduleTick(nextDelay)
      }
    } catch (error) {
      const err = toLoggableError(error)
      logger.error({ err }, 'Unexpected error in database queue runner loop')
      if (running) {
        scheduleTick(pollIntervalMs)
      }
    } finally {
      activeTickPromise = null
    }
  }

  const scheduleTick = (delay: number) => {
    if (!running) return
    timeoutId = setTimeout(() => {
      timeoutId = null
      if (!running) return
      activeTickPromise = tick()
    }, delay)
  }

  scheduleTick(0)

  return {
    stop: async (timeoutMs?: number): Promise<void> => {
      running = false
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (activeTickPromise) {
        if (typeof timeoutMs === 'number' && timeoutMs > 0) {
          await Promise.race([
            activeTickPromise,
            new Promise((resolve) => setTimeout(resolve, timeoutMs))
          ])
        } else {
          await activeTickPromise
        }
      }
    }
  }
}
