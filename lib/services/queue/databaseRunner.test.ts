import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import {
  processDueQueueJobs,
  startDatabaseQueueRunner
} from '@/lib/services/queue/databaseRunner'
import { JobMessage } from '@/lib/services/queue/type'

describe('databaseRunner', () => {
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

  const sampleMessage: JobMessage = {
    id: 'test-runner-msg-1',
    name: 'deliverActivity',
    data: { hello: 'world' }
  }

  it('processes a due job successfully and marks it completed', async () => {
    await database.createQueueJob({
      id: 'job-success-1',
      name: 'deliverActivity',
      payload: sampleMessage,
      nextRunAt: new Date(Date.now() - 1000)
    })

    const executed: string[] = []
    const handleJob = async (message: JobMessage) => {
      executed.push(message.id)
    }

    const processed = await processDueQueueJobs(database, {
      limit: 10,
      handleJob
    })

    expect(processed).toBe(1)
    expect(executed).toContain('test-runner-msg-1')

    const job = await database.getQueueJobById('job-success-1')
    expect(job?.status).toBe('completed')
  })

  it('schedules retry with backoff when job execution fails', async () => {
    await database.createQueueJob({
      id: 'job-retry-1',
      name: 'deliverActivity',
      payload: sampleMessage,
      attempts: 0,
      maxRetries: 3,
      nextRunAt: new Date(Date.now() - 1000)
    })

    const handleJob = async () => {
      throw new Error('503 Service Unavailable')
    }

    const before = Date.now()
    const processed = await processDueQueueJobs(database, {
      limit: 10,
      handleJob,
      backoffOptions: { jitter: false }
    })

    expect(processed).toBe(1)

    const job = await database.getQueueJobById('job-retry-1')
    expect(job?.status).toBe('pending')
    expect(job?.attempts).toBe(1)
    expect(job?.lastErrorMessage).toBe('503 Service Unavailable')
    // Attempt 1 without jitter: 1^4 + 15 = 16 seconds
    expect(job?.nextRunAt).toBeGreaterThanOrEqual(before + 15 * 1000)
  })

  it('captures to dead_letter_jobs when retries are exhausted', async () => {
    await database.createQueueJob({
      id: 'job-exhausted-1',
      name: 'deliverActivity',
      payload: sampleMessage,
      attempts: 2,
      maxRetries: 3,
      nextRunAt: new Date(Date.now() - 1000)
    })

    const handleJob = async () => {
      throw new Error('Fatal 500 Internal Error')
    }

    const processed = await processDueQueueJobs(database, {
      limit: 10,
      handleJob
    })

    expect(processed).toBe(1)

    const job = await database.getQueueJobById('job-exhausted-1')
    expect(job?.status).toBe('failed')
    expect(job?.attempts).toBe(3)
    expect(job?.lastErrorMessage).toBe('Fatal 500 Internal Error')

    // Verify DLQ entry
    const dlq = await database.getDeadLetterJobById('job-exhausted-1')
    expect(dlq).not.toBeNull()
    expect(dlq?.id).toBe('job-exhausted-1')
    expect(dlq?.jobName).toBe('deliverActivity')
    expect(dlq?.errorMessage).toBe('Fatal 500 Internal Error')
    expect(dlq?.attempts).toBe(3)
    expect(dlq?.status).toBe('failed')
  })

  it('prevents duplicate processing when job is already claimed', async () => {
    await database.createQueueJob({
      id: 'job-concurrent-1',
      name: 'deliverActivity',
      payload: sampleMessage,
      nextRunAt: new Date(Date.now() - 1000)
    })

    // Simulate concurrent worker claiming it first
    await database.claimQueueJob('job-concurrent-1')

    let called = false
    const handleJob = async () => {
      called = true
    }

    const processed = await processDueQueueJobs(database, {
      limit: 10,
      handleJob
    })

    expect(processed).toBe(0)
    expect(called).toBe(false)
  })

  it('starts and stops the queue runner loop', async () => {
    let callCount = 0
    const handleJob = async () => {
      callCount++
    }

    const runner = startDatabaseQueueRunner(database, {
      pollIntervalMs: 50,
      handleJob
    })

    // Let it tick once
    await new Promise((resolve) => setTimeout(resolve, 60))
    runner.stop()

    const countAfterStop = callCount
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(callCount).toBe(countAfterStop)
  })
})
