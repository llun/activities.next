import knex, { Knex } from 'knex'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { DatabaseQueue } from '@/lib/services/queue/database'
import { DatabaseDLQProvider } from '@/lib/services/queue/dlq/database'
import { JobMessage, Queue } from '@/lib/services/queue/type'

describe('DatabaseDLQProvider', () => {
  let knexDatabase: Knex
  let database: Database
  let dbQueue: DatabaseQueue

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
    dbQueue = new DatabaseQueue(undefined, database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    await knexDatabase('dead_letter_jobs').delete()
    await knexDatabase('queue_jobs').delete()
  })

  const samplePayload: JobMessage = {
    id: 'dlq-job-1',
    name: 'deliverActivity',
    data: { inbox: 'https://example.com/inbox' }
  }

  describe('DatabaseQueue replay routing', () => {
    it('routes retryJob through transactional database replay', async () => {
      const provider = new DatabaseDLQProvider(database, dbQueue)

      await dbQueue.publish(samplePayload)
      const claimed = await database.claimQueueJob({ id: 'dlq-job-1' })
      await database.failQueueJobWithDeadLetter({
        id: 'dlq-job-1',
        claimToken: claimed!.claimToken,
        attempts: 16,
        error: new Error('Database job failed')
      })

      const dlqBefore = await database.getDeadLetterJobById('dlq-job-1')
      expect(dlqBefore?.status).toBe('failed')

      const result = await provider.retryJob('dlq-job-1')
      expect(result.success).toBe(true)

      const dlqAfter = await database.getDeadLetterJobById('dlq-job-1')
      expect(dlqAfter?.status).toBe('retried')

      const queueJobAfter = await database.getQueueJobById('dlq-job-1')
      expect(queueJobAfter?.status).toBe('pending')
      expect(queueJobAfter?.attempts).toBe(0)
    })

    it('returns error when retryJob is called for nonexistent or unfailed job', async () => {
      const provider = new DatabaseDLQProvider(database, dbQueue)

      const notFoundResult = await provider.retryJob('nonexistent-id')
      expect(notFoundResult.success).toBe(false)
      expect(notFoundResult.error).toBe('Job not found')
    })

    it('routes retryJobs through transactional database replay in batch', async () => {
      const provider = new DatabaseDLQProvider(database, dbQueue)

      for (const id of ['batch-1', 'batch-2']) {
        const payload: JobMessage = { ...samplePayload, id }
        await dbQueue.publish(payload)
        const claimed = await database.claimQueueJob({ id })
        await database.failQueueJobWithDeadLetter({
          id,
          claimToken: claimed!.claimToken,
          attempts: 16,
          error: new Error('Batch failure')
        })
      }

      const result = await provider.retryJobs([
        'batch-1',
        'batch-2',
        'nonexistent'
      ])
      expect(result.success).toBe(true)
      expect(result.count).toBe(2)

      const job1 = await database.getQueueJobById('batch-1')
      const job2 = await database.getQueueJobById('batch-2')
      expect(job1?.status).toBe('pending')
      expect(job1?.attempts).toBe(0)
      expect(job2?.status).toBe('pending')
      expect(job2?.attempts).toBe(0)
    })

    it('routes retryAll through transactional database replay for all failed jobs', async () => {
      const provider = new DatabaseDLQProvider(database, dbQueue)

      for (const id of ['all-1', 'all-2', 'all-3']) {
        const payload: JobMessage = { ...samplePayload, id }
        await dbQueue.publish(payload)
        const claimed = await database.claimQueueJob({ id })
        await database.failQueueJobWithDeadLetter({
          id,
          claimToken: claimed!.claimToken,
          attempts: 16,
          error: new Error('All failure')
        })
      }

      const result = await provider.retryAll()
      expect(result.success).toBe(true)
      expect(result.count).toBe(3)

      for (const id of ['all-1', 'all-2', 'all-3']) {
        const job = await database.getQueueJobById(id)
        expect(job?.status).toBe('pending')
        expect(job?.attempts).toBe(0)
        const dlq = await database.getDeadLetterJobById(id)
        expect(dlq?.status).toBe('retried')
      }
    })
  })

  describe('CloudTasks / broker queue replay', () => {
    it('preserves broker republishing for non-database queues without requiring queue_jobs rows', async () => {
      const mockPublish = vi.fn().mockResolvedValue(undefined)
      const mockQueue: Queue = {
        runsInline: false,
        publish: mockPublish,
        handle: vi.fn()
      }

      const provider = new DatabaseDLQProvider(database, mockQueue)

      // Insert directly into dead_letter_jobs (as CloudTasks DLQ does without queue_jobs table)
      await knexDatabase('dead_letter_jobs').insert({
        id: 'cloudtasks-job-1',
        job_name: 'deliverActivity',
        payload: JSON.stringify(samplePayload),
        error_message: 'CloudTasks task deadline exceeded',
        attempts: 5,
        status: 'failed',
        created_at: new Date(),
        updated_at: new Date()
      })

      // Ensure no queue_jobs row exists
      const queueJob = await database.getQueueJobById('cloudtasks-job-1')
      expect(queueJob).toBeNull()

      const result = await provider.retryJob('cloudtasks-job-1')
      expect(result.success).toBe(true)
      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect(mockPublish).toHaveBeenCalledWith(samplePayload)

      const dlqAfter = await database.getDeadLetterJobById('cloudtasks-job-1')
      expect(dlqAfter?.status).toBe('retried')
    })

    it('handles broker retryJobs in batch', async () => {
      const mockPublish = vi.fn().mockResolvedValue(undefined)
      const mockQueue: Queue = {
        runsInline: false,
        publish: mockPublish,
        handle: vi.fn()
      }

      const provider = new DatabaseDLQProvider(database, mockQueue)

      for (const id of ['ct-batch-1', 'ct-batch-2']) {
        await knexDatabase('dead_letter_jobs').insert({
          id,
          job_name: 'deliverActivity',
          payload: JSON.stringify({ ...samplePayload, id }),
          error_message: 'Failure',
          attempts: 5,
          status: 'failed',
          created_at: new Date(),
          updated_at: new Date()
        })
      }

      const result = await provider.retryJobs(['ct-batch-1', 'ct-batch-2'])
      expect(result.success).toBe(true)
      expect(result.count).toBe(2)
      expect(mockPublish).toHaveBeenCalledTimes(2)
    })

    it('handles broker retryAll', async () => {
      const mockPublish = vi.fn().mockResolvedValue(undefined)
      const mockQueue: Queue = {
        runsInline: false,
        publish: mockPublish,
        handle: vi.fn()
      }

      const provider = new DatabaseDLQProvider(database, mockQueue)

      for (const id of ['ct-all-1', 'ct-all-2']) {
        await knexDatabase('dead_letter_jobs').insert({
          id,
          job_name: 'deliverActivity',
          payload: JSON.stringify({ ...samplePayload, id }),
          error_message: 'Failure',
          attempts: 5,
          status: 'failed',
          created_at: new Date(),
          updated_at: new Date()
        })
      }

      const result = await provider.retryAll()
      expect(result.success).toBe(true)
      expect(result.count).toBe(2)
      expect(mockPublish).toHaveBeenCalledTimes(2)
    })
  })

  describe('Management actions', () => {
    it('discards, deletes, and counts dead letter jobs', async () => {
      const provider = new DatabaseDLQProvider(database, dbQueue)

      await knexDatabase('dead_letter_jobs').insert({
        id: 'manage-1',
        job_name: 'deliverActivity',
        payload: JSON.stringify(samplePayload),
        error_message: 'Err',
        attempts: 1,
        status: 'failed',
        created_at: new Date(),
        updated_at: new Date()
      })

      const listBefore = await provider.getJobs()
      expect(listBefore.total).toBe(1)
      expect(listBefore.counts.failed).toBe(1)

      const discardResult = await provider.discardJob('manage-1')
      expect(discardResult.success).toBe(true)

      const listAfterDiscard = await provider.getJobs()
      expect(listAfterDiscard.counts.discarded).toBe(1)

      const clearResult = await provider.clearDiscarded()
      expect(clearResult.success).toBe(true)
      expect(clearResult.count).toBe(1)

      const listAfterClear = await provider.getJobs()
      expect(listAfterClear.total).toBe(0)
    })
  })
})
