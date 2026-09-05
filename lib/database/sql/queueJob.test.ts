import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { JobMessage } from '@/lib/services/queue/type'

describe('QueueJobDatabase', () => {
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

  const samplePayload: JobMessage = {
    id: 'job-123',
    name: 'deliverActivity',
    data: { inbox: 'https://example.com/inbox', activity: { type: 'Create' } }
  }

  it('creates queue jobs and retrieves by id', async () => {
    const job = await database.createQueueJob({
      id: 'custom-id-1',
      name: 'deliverActivity',
      payload: samplePayload,
      attempts: 0,
      maxRetries: 16
    })

    expect(job.id).toBe('custom-id-1')
    expect(job.name).toBe('deliverActivity')
    expect(job.status).toBe('pending')
    expect(job.attempts).toBe(0)
    expect(job.maxRetries).toBe(16)
    expect(job.payload).toEqual(samplePayload)
    expect(job.createdAt).toBeTypeOf('number')
    expect(job.nextRunAt).toBeTypeOf('number')

    const fetched = await database.getQueueJobById('custom-id-1')
    expect(fetched).toEqual(job)
  })

  it('returns due jobs filtered by next_run_at and status', async () => {
    const now = Date.now()

    // Due job (past)
    await database.createQueueJob({
      id: 'due-1',
      name: 'deliverActivity',
      payload: samplePayload,
      nextRunAt: new Date(now - 10000)
    })

    // Future job (not due yet)
    await database.createQueueJob({
      id: 'future-1',
      name: 'deliverActivity',
      payload: samplePayload,
      nextRunAt: new Date(now + 60000)
    })

    const dueJobs = await database.getDueQueueJobs({
      now: new Date(now)
    })
    const ids = dueJobs.map((j) => j.id)

    expect(ids).toContain('due-1')
    expect(ids).not.toContain('future-1')
  })

  it('atomically claims a pending job, preventing duplicate processing', async () => {
    await database.createQueueJob({
      id: 'claimable-1',
      name: 'deliverActivity',
      payload: samplePayload
    })

    const firstClaim = await database.claimQueueJob('claimable-1')
    expect(firstClaim).toBe(true)

    // Second claim must fail because status is now processing
    const secondClaim = await database.claimQueueJob('claimable-1')
    expect(secondClaim).toBe(false)

    const job = await database.getQueueJobById('claimable-1')
    expect(job?.status).toBe('processing')
  })

  it('completes a job', async () => {
    await database.createQueueJob({
      id: 'completable-1',
      name: 'deliverActivity',
      payload: samplePayload
    })

    await database.claimQueueJob('completable-1')
    const completed = await database.completeQueueJob('completable-1')
    expect(completed).toBe(true)

    const job = await database.getQueueJobById('completable-1')
    expect(job?.status).toBe('completed')
  })

  it('schedules retry with updated attempts, error details, and resets status to pending', async () => {
    await database.createQueueJob({
      id: 'retryable-1',
      name: 'deliverActivity',
      payload: samplePayload
    })

    await database.claimQueueJob('retryable-1')

    const nextRun = new Date(Date.now() + 5000)
    const err = new Error('Simulated network timeout')

    const scheduled = await database.scheduleQueueJobRetry({
      id: 'retryable-1',
      nextRunAt: nextRun,
      attempts: 1,
      error: err
    })
    expect(scheduled).toBe(true)

    const job = await database.getQueueJobById('retryable-1')
    expect(job?.status).toBe('pending')
    expect(job?.attempts).toBe(1)
    expect(job?.lastErrorMessage).toBe('Simulated network timeout')
    expect(job?.lastErrorStack).toContain('Error: Simulated network timeout')
  })

  it('fails a job terminally', async () => {
    await database.createQueueJob({
      id: 'failable-1',
      name: 'deliverActivity',
      payload: samplePayload
    })

    await database.claimQueueJob('failable-1')

    const err = new Error('Permanent 410 Gone')
    const failed = await database.failQueueJob({
      id: 'failable-1',
      attempts: 16,
      error: err
    })
    expect(failed).toBe(true)

    const job = await database.getQueueJobById('failable-1')
    expect(job?.status).toBe('failed')
    expect(job?.attempts).toBe(16)
    expect(job?.lastErrorMessage).toBe('Permanent 410 Gone')
  })

  it('counts and deletes jobs', async () => {
    const pendingBefore = await database.countQueueJobs({ status: 'pending' })
    expect(pendingBefore).toBeGreaterThan(0)

    const deleted = await database.deleteQueueJob('custom-id-1')
    expect(deleted).toBe(true)

    const notFound = await database.getQueueJobById('custom-id-1')
    expect(notFound).toBeNull()
  })
})
