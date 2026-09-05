import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { withSpan } from '@/lib/utils/trace'

import { defaultJobHandle } from './base'
import { JobMessage, Queue } from './type'

export const DatabaseQueueConfig = z.object({
  type: z.literal('database'),
  maxRetries: z.number().int().positive().optional(),
  pollIntervalMs: z.number().int().positive().optional()
})
export type DatabaseQueueConfig = z.infer<typeof DatabaseQueueConfig>

export class DatabaseQueue implements Queue {
  readonly runsInline = false

  private config?: DatabaseQueueConfig
  private database?: Database

  constructor(config?: DatabaseQueueConfig, database?: Database) {
    this.config = config
    this.database = database
  }

  async publish(message: JobMessage): Promise<void> {
    return withSpan(
      'queue',
      'publish',
      {
        queueName: 'database',
        jobName: message.name
      },
      async (span) => {
        const database = this.database ?? getDatabase()
        if (!database) {
          throw new Error('Database is not available for DatabaseQueue')
        }

        const delaySeconds = message.delaySeconds ?? 0
        const nextRunAt =
          delaySeconds > 0
            ? new Date(Date.now() + delaySeconds * 1000)
            : new Date()

        const maxRetries = this.config?.maxRetries ?? 16

        const job = await database.createQueueJob({
          id: message.id,
          name: message.name,
          payload: message,
          attempts: 0,
          maxRetries,
          nextRunAt,
          status: 'pending'
        })

        span.addEvent('queue_job_published', {
          'queue.job_id': job.id,
          'queue.job_name': job.name,
          'queue.delay_seconds': delaySeconds,
          'queue.next_run_at': new Date(job.nextRunAt).toISOString()
        })
      }
    )
  }

  async handle(message: JobMessage): Promise<void> {
    return defaultJobHandle('database')(message)
  }
}
