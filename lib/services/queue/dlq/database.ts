import { getDatabase } from '@/lib/database'
import { getQueue } from '@/lib/services/queue'
import { logger } from '@/lib/utils/logger'

import {
  DLQActionResult,
  DLQJobItem,
  DLQProvider,
  GetDLQJobsParams,
  GetDLQJobsResult
} from './types'

export class DatabaseDLQProvider implements DLQProvider {
  readonly type = 'database' as const

  private getDatabase() {
    const database = getDatabase()
    if (!database) {
      throw new Error('Database is not initialized')
    }
    return database
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
    const job = await database.getDeadLetterJobById(id)
    if (!job) {
      logger.warn({ id }, 'Cannot retry dead letter job: not found in database')
      return { success: false, error: 'Job not found' }
    }

    try {
      await getQueue().publish(job.payload)
      await database.updateDeadLetterJobStatus(id, 'retried')
      return { success: true }
    } catch (error) {
      logger.error({
        err: error,
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
    const failedJobs = await database.getDeadLetterJobs({
      status: 'failed',
      limit: 1000
    })

    const queue = getQueue()
    let retriedCount = 0
    for (const job of failedJobs) {
      try {
        await queue.publish(job.payload)
        await database.updateDeadLetterJobStatus(job.id, 'retried')
        retriedCount++
      } catch (error) {
        logger.error({
          err: error,
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
    const queue = getQueue()
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
          err: error,
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
