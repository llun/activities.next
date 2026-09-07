import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getQueue } from '@/lib/services/queue'
import { DatabaseQueue } from '@/lib/services/queue/database'
import { Queue } from '@/lib/services/queue/type'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import {
  DLQActionResult,
  DLQJobItem,
  DLQProvider,
  GetDLQJobsParams,
  GetDLQJobsResult
} from './types'

export class DatabaseDLQProvider implements DLQProvider {
  readonly type = 'database' as const

  private database?: Database
  private queue?: Queue

  constructor(database?: Database, queue?: Queue) {
    this.database = database
    this.queue = queue
  }

  private getDatabase() {
    const database = this.database ?? getDatabase()
    if (!database) {
      throw new Error('Database is not initialized')
    }
    return database
  }

  private getQueue(): Queue {
    return this.queue ?? getQueue()
  }

  async getJobs(params?: GetDLQJobsParams): Promise<GetDLQJobsResult> {
    const database = this.getDatabase()
    const limit = params?.limit ?? 20
    const offset = params?.offset ?? 0
    const status = params?.status

    const [jobs, total, allCount, failedCount, retriedCount, discardedCount] =
      await Promise.all([
        database.getDeadLetterJobs({ status, limit, offset }),
        database.countDeadLetterJobs({ status }),
        database.countDeadLetterJobs(),
        database.countDeadLetterJobs({ status: 'failed' }),
        database.countDeadLetterJobs({ status: 'retried' }),
        database.countDeadLetterJobs({ status: 'discarded' })
      ])

    const formattedJobs: DLQJobItem[] = jobs.map((job) => ({
      id: job.id,
      jobName: job.jobName,
      payload: job.payload,
      errorMessage: job.errorMessage,
      errorStack: job.errorStack,
      attempts: job.attempts,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    }))

    return {
      jobs: formattedJobs,
      total,
      counts: {
        all: allCount,
        failed: failedCount,
        retried: retriedCount,
        discarded: discardedCount
      }
    }
  }

  async retryJob(id: string): Promise<DLQActionResult> {
    const database = this.getDatabase()
    const queue = this.getQueue()

    if (queue instanceof DatabaseQueue) {
      const success = await database.replayQueueJob({ id })
      if (!success) {
        logger.warn(
          { id },
          'Cannot replay dead letter job: not found in database or not failed'
        )
        return { success: false, error: 'Job not found' }
      }
      return { success: true }
    }

    const job = await database.getDeadLetterJobById(id)
    if (!job) {
      logger.warn({ id }, 'Cannot retry dead letter job: not found in database')
      return { success: false, error: 'Job not found' }
    }

    try {
      await queue.publish(job.payload)
      await database.updateDeadLetterJobStatus(id, 'retried')
      return { success: true }
    } catch (error) {
      logger.error({
        err: toLoggableError(error),
        id,
        message: 'Failed to re-dispatch dead letter job'
      })
      return { success: false, error: 'Failed to publish job' }
    }
  }

  async discardJob(id: string): Promise<DLQActionResult> {
    const database = this.getDatabase()
    await database.updateDeadLetterJobStatus(id, 'discarded')
    return { success: true }
  }

  async retryAll(): Promise<DLQActionResult> {
    const database = this.getDatabase()
    const queue = this.getQueue()
    const failedJobs = await database.getDeadLetterJobs({
      status: 'failed',
      limit: 1000
    })

    if (queue instanceof DatabaseQueue) {
      let retriedCount = 0
      for (const job of failedJobs) {
        const success = await database.replayQueueJob({ id: job.id })
        if (success) {
          retriedCount++
        }
      }
      return { success: true, count: retriedCount }
    }

    let retriedCount = 0
    for (const job of failedJobs) {
      try {
        await queue.publish(job.payload)
        await database.updateDeadLetterJobStatus(job.id, 'retried')
        retriedCount++
      } catch (error) {
        logger.error({
          err: toLoggableError(error),
          jobId: job.id,
          message: 'Failed to retry dead letter job in batch'
        })
      }
    }

    return { success: true, count: retriedCount }
  }

  async clearDiscarded(): Promise<DLQActionResult> {
    const database = this.getDatabase()
    const count = await database.deleteDeadLetterJobsByStatus('discarded')
    return { success: true, count }
  }

  async dropAll(): Promise<DLQActionResult> {
    const database = this.getDatabase()
    const count = await database.deleteAllDeadLetterJobs()
    return { success: true, count }
  }

  async retryJobs(ids: string[]): Promise<DLQActionResult> {
    const database = this.getDatabase()
    const queue = this.getQueue()

    if (queue instanceof DatabaseQueue) {
      let retriedCount = 0
      for (const id of ids) {
        const success = await database.replayQueueJob({ id })
        if (success) {
          retriedCount++
        }
      }
      return { success: true, count: retriedCount }
    }

    let retriedCount = 0
    for (const id of ids) {
      const job = await database.getDeadLetterJobById(id)
      if (!job) continue

      try {
        await queue.publish(job.payload)
        await database.updateDeadLetterJobStatus(id, 'retried')
        retriedCount++
      } catch (error) {
        logger.error({
          err: toLoggableError(error),
          jobId: id,
          message: 'Failed to retry dead letter job'
        })
      }
    }

    return { success: true, count: retriedCount }
  }

  async deleteJobs(ids: string[]): Promise<DLQActionResult> {
    const database = this.getDatabase()
    const count = await database.deleteDeadLetterJobs(ids)
    return { success: true, count }
  }
}
