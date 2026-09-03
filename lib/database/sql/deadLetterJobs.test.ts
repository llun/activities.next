import { describe, expect, it } from 'vitest'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { JobMessage } from '@/lib/services/queue/type'

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const database = getTestSQLDatabase()
  await database.migrate()
  try {
    await test(database)
  } finally {
    await database.destroy()
  }
}

describe('DeadLetterJobSQLDatabaseMixin', () => {
  const samplePayload: JobMessage = {
    id: 'msg-1',
    name: 'createNote',
    data: { text: 'Hello world' }
  }

  it('creates a dead letter job with defaults', async () => {
    await withFreshDatabase(async (database) => {
      const job = await database.createDeadLetterJob({
        jobName: 'createNote',
        payload: samplePayload,
        errorMessage: 'Network timeout',
        errorStack: 'Error: Network timeout\n  at fetch (index.js:1)'
      })

      expect(job.id).toBeTruthy()
      expect(job.jobName).toBe('createNote')
      expect(job.payload).toEqual(samplePayload)
      expect(job.errorMessage).toBe('Network timeout')
      expect(job.errorStack).toContain('Network timeout')
      expect(job.attempts).toBe(1)
      expect(job.status).toBe('failed')
      expect(typeof job.createdAt).toBe('number')
      expect(typeof job.updatedAt).toBe('number')

      const fetched = await database.getDeadLetterJobById(job.id)
      expect(fetched).toEqual(job)
    })
  })

  it('creates a dead letter job with custom id and attempts', async () => {
    await withFreshDatabase(async (database) => {
      const customId = 'custom-uuid-123'
      const job = await database.createDeadLetterJob({
        id: customId,
        job_name: 'sendEmail',
        payload: samplePayload,
        error_message: 'SMTP down',
        attempts: 5,
        status: 'failed'
      })

      expect(job.id).toBe(customId)
      expect(job.jobName).toBe('sendEmail')
      expect(job.attempts).toBe(5)
      expect(job.status).toBe('failed')
    })
  })

  it('retrieves jobs with status filter, limit, and offset', async () => {
    await withFreshDatabase(async (database) => {
      const _job1 = await database.createDeadLetterJob({
        jobName: 'job1',
        payload: samplePayload,
        errorMessage: 'err1',
        status: 'failed'
      })
      const _job2 = await database.createDeadLetterJob({
        jobName: 'job2',
        payload: samplePayload,
        errorMessage: 'err2',
        status: 'failed'
      })
      const job3 = await database.createDeadLetterJob({
        jobName: 'job3',
        payload: samplePayload,
        errorMessage: 'err3',
        status: 'discarded'
      })

      const allJobs = await database.getDeadLetterJobs()
      expect(allJobs).toHaveLength(3)

      const failedJobs = await database.getDeadLetterJobs({ status: 'failed' })
      expect(failedJobs).toHaveLength(2)
      expect(failedJobs.map((j) => j.jobName).sort()).toEqual(['job1', 'job2'])

      const discardedJobs = await database.getDeadLetterJobs({
        status: 'discarded'
      })
      expect(discardedJobs).toHaveLength(1)
      expect(discardedJobs[0].id).toBe(job3.id)

      const paged = await database.getDeadLetterJobs({ limit: 1, offset: 0 })
      expect(paged).toHaveLength(1)

      const pagedSecond = await database.getDeadLetterJobs({
        limit: 1,
        offset: 1
      })
      expect(pagedSecond).toHaveLength(1)
      expect(pagedSecond[0].id).not.toBe(paged[0].id)
    })
  })

  it('counts dead letter jobs correctly', async () => {
    await withFreshDatabase(async (database) => {
      await database.createDeadLetterJob({
        jobName: 'job1',
        payload: samplePayload,
        errorMessage: 'err1',
        status: 'failed'
      })
      await database.createDeadLetterJob({
        jobName: 'job2',
        payload: samplePayload,
        errorMessage: 'err2',
        status: 'failed'
      })
      await database.createDeadLetterJob({
        jobName: 'job3',
        payload: samplePayload,
        errorMessage: 'err3',
        status: 'retried'
      })

      expect(await database.countDeadLetterJobs()).toBe(3)
      expect(await database.countDeadLetterJobs({ status: 'failed' })).toBe(2)
      expect(await database.countDeadLetterJobs({ status: 'retried' })).toBe(1)
      expect(await database.countDeadLetterJobs({ status: 'discarded' })).toBe(
        0
      )
    })
  })

  it('updates job status', async () => {
    await withFreshDatabase(async (database) => {
      const job = await database.createDeadLetterJob({
        jobName: 'jobToUpdate',
        payload: samplePayload,
        errorMessage: 'err',
        status: 'failed'
      })

      const updated = await database.updateDeadLetterJobStatus(
        job.id,
        'retried'
      )
      expect(updated).not.toBeNull()
      expect(updated?.status).toBe('retried')
      expect(updated?.id).toBe(job.id)

      const fetched = await database.getDeadLetterJobById(job.id)
      expect(fetched?.status).toBe('retried')

      const nonExistent = await database.updateDeadLetterJobStatus(
        'missing-id',
        'discarded'
      )
      expect(nonExistent).toBeNull()
    })
  })

  it('deletes job by id', async () => {
    await withFreshDatabase(async (database) => {
      const job = await database.createDeadLetterJob({
        jobName: 'jobToDelete',
        payload: samplePayload,
        errorMessage: 'err',
        status: 'failed'
      })

      const deleted = await database.deleteDeadLetterJob(job.id)
      expect(deleted).toBe(true)

      const fetched = await database.getDeadLetterJobById(job.id)
      expect(fetched).toBeNull()

      const deletedAgain = await database.deleteDeadLetterJob(job.id)
      expect(deletedAgain).toBe(false)
    })
  })

  it('deletes jobs by status (batch purge)', async () => {
    await withFreshDatabase(async (database) => {
      await database.createDeadLetterJob({
        jobName: 'j1',
        payload: samplePayload,
        errorMessage: 'err1',
        status: 'discarded'
      })
      await database.createDeadLetterJob({
        jobName: 'j2',
        payload: samplePayload,
        errorMessage: 'err2',
        status: 'discarded'
      })
      await database.createDeadLetterJob({
        jobName: 'j3',
        payload: samplePayload,
        errorMessage: 'err3',
        status: 'failed'
      })

      const deletedCount =
        await database.deleteDeadLetterJobsByStatus('discarded')
      expect(deletedCount).toBe(2)

      const remaining = await database.getDeadLetterJobs()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].status).toBe('failed')
    })
  })
})
