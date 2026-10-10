import knex, { Knex } from 'knex'

import { type Db, kyselyFor } from '@/lib/database/kysely'
import { getSQLDatabase } from '@/lib/database/sql'
import { getQueueJobById } from '@/lib/database/testing/fixtures'
import { Database } from '@/lib/database/types'
import { DatabaseQueue } from '@/lib/services/queue/database'
import { JobMessage } from '@/lib/services/queue/type'

describe('DatabaseQueue', () => {
  let knexDatabase: Knex
  let database: Database
  let db: Db

  beforeAll(async () => {
    knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    database = getSQLDatabase(knexDatabase)
    db = kyselyFor(knexDatabase)
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
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

    const job = await getQueueJobById(db, 'db-queue-job-1')
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

    const job = await getQueueJobById(db, 'db-queue-delayed-1')
    expect(job).not.toBeNull()
    expect(job?.nextRunAt).toBeGreaterThanOrEqual(before + 115 * 1000)
  })

  it('preserves existing job state on duplicate publish and resets attempts only on explicit replay', async () => {
    const queue = new DatabaseQueue(undefined, database)
    const message: JobMessage = {
      id: 'db-queue-idempotent-1',
      name: 'deliverActivity',
      data: { original: true }
    }

    await queue.publish(message)

    // Simulate job failing terminally in database with dead letter
    const claimed = await database.claimQueueJob({
      id: 'db-queue-idempotent-1'
    })
    expect(claimed).not.toBeNull()
    await database.failQueueJobWithDeadLetter({
      id: 'db-queue-idempotent-1',
      claimToken: claimed!.claimToken,
      attempts: 16,
      error: new Error('Terminal failure')
    })
    const failed = await getQueueJobById(db, 'db-queue-idempotent-1')
    expect(failed?.status).toBe('failed')
    expect(failed?.attempts).toBe(16)

    // Re-publish with duplicate ID must preserve existing failed status and attempts (idempotent enqueue)
    await expect(
      queue.publish({
        ...message,
        data: { modified: true }
      })
    ).resolves.toBeUndefined()

    const stillFailed = await getQueueJobById(db, 'db-queue-idempotent-1')
    expect(stillFailed?.status).toBe('failed')
    expect(stillFailed?.attempts).toBe(16)
    expect(stillFailed?.payload).toEqual(message)

    // Explicit replay resets attempts and status to pending
    const replaySuccess = await queue.replay('db-queue-idempotent-1')
    expect(replaySuccess).toBe(true)

    const retried = await getQueueJobById(db, 'db-queue-idempotent-1')
    expect(retried?.status).toBe('pending')
    expect(retried?.attempts).toBe(0)
  })
})
