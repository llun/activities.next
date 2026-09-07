import knex, { Knex } from 'knex'

import { DatabaseQueueConfig as LeafDatabaseQueueConfig } from '@/lib/config/queue'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import {
  DatabaseQueue,
  DatabaseQueueConfig
} from '@/lib/services/queue/database'
import { JobMessage } from '@/lib/services/queue/type'

describe('DatabaseQueue', () => {
  let knexDatabase: Knex
  let database: Database

  beforeAll(async () => {
    knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    database = getSQLDatabase(knexDatabase)
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('re-exports DatabaseQueueConfig matching leaf queue config', () => {
    expect(DatabaseQueueConfig).toBe(LeafDatabaseQueueConfig)
    const parsed = DatabaseQueueConfig.safeParse({
      type: 'database',
      maxRetries: 5,
      pollIntervalMs: 2000
    })
    expect(parsed.success).toBe(true)
  })

  it('declares runsInline as false', () => {
    const queue = new DatabaseQueue(undefined, database)
    expect(queue.runsInline).toBe(false)
  })

  it('publishes immediate job to database with pending status', async () => {
    const queue = new DatabaseQueue(
      { type: 'database', maxRetries: 5 },
      database
    )
    const message: JobMessage = {
      id: 'db-queue-job-1',
      name: 'deliverActivity',
      data: { test: true }
    }

    await queue.publish(message)

    const job = await database.getQueueJobById('db-queue-job-1')
    expect(job).not.toBeNull()
    expect(job?.id).toBe('db-queue-job-1')
    expect(job?.name).toBe('deliverActivity')
    expect(job?.status).toBe('pending')
    expect(job?.maxRetries).toBe(5)
    expect(job?.payload).toEqual(message)
  })

  it('publishes delayed job with future nextRunAt', async () => {
    const queue = new DatabaseQueue(undefined, database)
    const message: JobMessage = {
      id: 'db-queue-delayed-1',
      name: 'deliverActivity',
      data: { delayed: true },
      delaySeconds: 120
    }

    const before = Date.now()
    await queue.publish(message)

    const job = await database.getQueueJobById('db-queue-delayed-1')
    expect(job).not.toBeNull()
    expect(job?.nextRunAt).toBeGreaterThanOrEqual(before + 115 * 1000)
  })

  it('re-publishes job with same ID cleanly without constraint violation (DLQ retry)', async () => {
    const queue = new DatabaseQueue(undefined, database)
    const message: JobMessage = {
      id: 'db-queue-dlq-retry-1',
      name: 'deliverActivity',
      data: { original: true }
    }

    await queue.publish(message)

    // Simulate job failing terminally in database
    const claimed = await database.claimQueueJob({
      id: 'db-queue-dlq-retry-1'
    })
    expect(claimed).not.toBeNull()
    await database.failQueueJob({
      id: 'db-queue-dlq-retry-1',
      claimToken: claimed!.claimToken,
      attempts: 16,
      error: new Error('Terminal failure')
    })
    const failed = await database.getQueueJobById('db-queue-dlq-retry-1')
    expect(failed?.status).toBe('failed')
    expect(failed?.attempts).toBe(16)

    // Re-publish from DLQ retry
    await expect(queue.publish(message)).resolves.toBeUndefined()

    const retried = await database.getQueueJobById('db-queue-dlq-retry-1')
    expect(retried?.status).toBe('pending')
    expect(retried?.attempts).toBe(0)
  })
})
