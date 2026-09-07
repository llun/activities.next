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

  afterEach(async () => {
    await knexDatabase('queue_jobs').delete()
    await knexDatabase('dead_letter_jobs').delete()
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
    await database.claimQueueJob({ id: 'job-concurrent-1' })

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

  it('executes the fresh claimed payload, not discovery query older row', async () => {
    const originalMessage: JobMessage = {
      id: 'fresh-payload-msg-old',
      name: 'deliverActivity',
      data: { version: 1 }
    }
    const updatedMessage: JobMessage = {
      id: 'fresh-payload-msg-new',
      name: 'deliverActivity',
      data: { version: 2 }
    }

    await database.createQueueJob({
      id: 'job-fresh-payload-1',
      name: 'deliverActivity',
      payload: originalMessage,
      nextRunAt: new Date(Date.now() - 1000)
    })

    // Update database payload directly before runner claims
    await knexDatabase('queue_jobs')
      .where({ id: 'job-fresh-payload-1' })
      .update({
        payload: JSON.stringify(updatedMessage)
      })

    const executedPayloads: JobMessage[] = []
    const handleJob = async (message: JobMessage) => {
      executedPayloads.push(message)
    }

    const processed = await processDueQueueJobs(database, {
      limit: 10,
      handleJob
    })

    expect(processed).toBe(1)
    expect(executedPayloads).toHaveLength(1)
    expect(executedPayloads[0].id).toBe('fresh-payload-msg-new')
    expect(executedPayloads[0].data).toEqual({ version: 2 })
  })

  it('rejects stale settlement when job is reclaimed by another worker during execution', async () => {
    await database.createQueueJob({
      id: 'job-stale-settlement-1',
      name: 'deliverActivity',
      payload: sampleMessage,
      nextRunAt: new Date(Date.now() - 1000)
    })

    let reclaimDone = false
    const handleJob = async () => {
      // While handler is executing, backdate and simulate a concurrent stalled reclaim
      const now = Date.now()
      await knexDatabase('queue_jobs')
        .where({ id: 'job-stale-settlement-1' })
        .update({
          updated_at: new Date(now - 30 * 60 * 1000)
        })

      const reclaimer = await database.claimQueueJob({
        id: 'job-stale-settlement-1',
        now: new Date(now),
        stalledBefore: new Date(now - 15 * 60 * 1000)
      })
      expect(reclaimer).not.toBeNull()
      reclaimDone = true
    }

    const processed = await processDueQueueJobs(database, {
      limit: 10,
      handleJob
    })

    expect(reclaimDone).toBe(true)
    // First worker's completeQueueJob should have returned false due to token mismatch, so processedCount = 0
    expect(processed).toBe(0)

    const job = await database.getQueueJobById('job-stale-settlement-1')
    expect(job?.status).toBe('processing')
  })

  it('rejects stale retry settlement when job is reclaimed by another worker during execution', async () => {
    await database.createQueueJob({
      id: 'job-stale-retry-1',
      name: 'deliverActivity',
      payload: sampleMessage,
      attempts: 0,
      maxRetries: 3,
      nextRunAt: new Date(Date.now() - 1000)
    })

    const handleJob = async () => {
      const now = Date.now()
      await knexDatabase('queue_jobs')
        .where({ id: 'job-stale-retry-1' })
        .update({
          updated_at: new Date(now - 30 * 60 * 1000)
        })

      await database.claimQueueJob({
        id: 'job-stale-retry-1',
        now: new Date(now),
        stalledBefore: new Date(now - 15 * 60 * 1000)
      })

      throw new Error('Temporary 503')
    }

    const processed = await processDueQueueJobs(database, {
      limit: 10,
      handleJob
    })

    expect(processed).toBe(0)
    const job = await database.getQueueJobById('job-stale-retry-1')
    expect(job?.status).toBe('processing')
    expect(job?.attempts).toBe(0)
  })

  it('rejects stale terminal failure settlement when job is reclaimed by another worker during execution', async () => {
    await database.createQueueJob({
      id: 'job-stale-fail-1',
      name: 'deliverActivity',
      payload: sampleMessage,
      attempts: 2,
      maxRetries: 3,
      nextRunAt: new Date(Date.now() - 1000)
    })

    const handleJob = async () => {
      const now = Date.now()
      await knexDatabase('queue_jobs')
        .where({ id: 'job-stale-fail-1' })
        .update({
          updated_at: new Date(now - 30 * 60 * 1000)
        })

      await database.claimQueueJob({
        id: 'job-stale-fail-1',
        now: new Date(now),
        stalledBefore: new Date(now - 15 * 60 * 1000)
      })

      throw new Error('Permanent 500')
    }

    const processed = await processDueQueueJobs(database, {
      limit: 10,
      handleJob
    })

    expect(processed).toBe(0)
    const job = await database.getQueueJobById('job-stale-fail-1')
    expect(job?.status).toBe('processing')
    expect(job?.attempts).toBe(2)

    const dlq = await database.getDeadLetterJobById('job-stale-fail-1')
    expect(dlq).toBeNull()
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
    await runner.stop()

    const countAfterStop = callCount
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(callCount).toBe(countAfterStop)
  })

  it('awaits currently running job and avoids claiming subsequent jobs on shutdown drain', async () => {
    await database.createQueueJob({
      id: 'job-drain-1',
      name: 'deliverActivity',
      payload: { ...sampleMessage, id: 'drain-msg-1' },
      nextRunAt: new Date(Date.now() - 1000)
    })
    await database.createQueueJob({
      id: 'job-drain-2',
      name: 'deliverActivity',
      payload: { ...sampleMessage, id: 'drain-msg-2' },
      nextRunAt: new Date(Date.now() - 1000)
    })

    let job1Started = false
    let resolveJob1: () => void = () => {}
    const job1Promise = new Promise<void>((resolve) => {
      resolveJob1 = resolve
    })
    const executed: string[] = []

    const handleJob = async (message: JobMessage) => {
      executed.push(message.id)
      if (message.id === 'drain-msg-1') {
        job1Started = true
        await job1Promise
      }
    }

    const runner = startDatabaseQueueRunner(database, {
      pollIntervalMs: 100,
      batchSize: 5,
      handleJob
    })

    // Wait until job 1 has started executing
    while (!job1Started) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    // Initiate stop while job 1 is in-flight
    let stopResolved = false
    const stopPromise = runner.stop().then(() => {
      stopResolved = true
    })

    // Brief delay to ensure stop() didn't immediately resolve
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(stopResolved).toBe(false)

    // Complete job 1
    resolveJob1()
    await stopPromise
    expect(stopResolved).toBe(true)

    // Job 1 should be completed
    const job1 = await database.getQueueJobById('job-drain-1')
    expect(job1?.status).toBe('completed')

    // Job 2 should never have been claimed
    const job2 = await database.getQueueJobById('job-drain-2')
    expect(job2?.status).toBe('pending')
    expect(executed).toEqual(['drain-msg-1'])
  })

  it('respects timeoutMs when draining if in-flight job takes too long', async () => {
    await database.createQueueJob({
      id: 'job-timeout-drain-1',
      name: 'deliverActivity',
      payload: { ...sampleMessage, id: 'timeout-msg-1' },
      nextRunAt: new Date(Date.now() - 1000)
    })

    let jobStarted = false
    let resolveJob: () => void = () => {}
    const jobPromise = new Promise<void>((resolve) => {
      resolveJob = resolve
    })

    const handleJob = async () => {
      jobStarted = true
      await jobPromise
    }

    const runner = startDatabaseQueueRunner(database, {
      pollIntervalMs: 100,
      batchSize: 5,
      handleJob
    })

    while (!jobStarted) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    const before = Date.now()
    // Stop with 50ms timeout
    await runner.stop(50)
    const elapsed = Date.now() - before

    expect(elapsed).toBeGreaterThanOrEqual(40)
    expect(elapsed).toBeLessThan(500)

    // Clean up hanging promise
    resolveJob()
  })

  it('allows idempotent stop calls', async () => {
    const runner = startDatabaseQueueRunner(database, {
      pollIntervalMs: 50,
      handleJob: async () => {}
    })

    await Promise.all([runner.stop(), runner.stop(), runner.stop()])
  })

  it('reclaims and processes orphaned jobs stuck in processing status past stalled timeout', async () => {
    const now = Date.now()

    await database.createQueueJob({
      id: 'job-stalled-runner-1',
      name: 'deliverActivity',
      payload: sampleMessage,
      status: 'processing'
    })

    // Backdate updated_at to simulate a worker that crashed 20 minutes ago
    await knexDatabase('queue_jobs')
      .where({ id: 'job-stalled-runner-1' })
      .update({
        status: 'processing',
        updated_at: new Date(now - 20 * 60 * 1000)
      })

    const executed: string[] = []
    const handleJob = async (message: JobMessage) => {
      executed.push(message.id)
    }

    const processed = await processDueQueueJobs(database, {
      limit: 10,
      now: new Date(now),
      handleJob,
      stalledTimeoutMs: 15 * 60 * 1000
    })

    expect(processed).toBe(1)
    expect(executed).toContain('test-runner-msg-1')

    const job = await database.getQueueJobById('job-stalled-runner-1')
    expect(job?.status).toBe('completed')
  })
})
