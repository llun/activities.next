import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { DatabaseQueue } from '@/lib/services/queue/database'
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
})
