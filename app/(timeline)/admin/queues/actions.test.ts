import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getQueue } from '@/lib/services/queue'
import { DeadLetterJob } from '@/lib/types/database/operations'

import {
  clearDiscardedJobs,
  discardDeadLetterJob,
  retryAllDeadLetterJobs,
  retryDeadLetterJob
} from './actions'

const mockDatabase = {
  getDeadLetterJobById: vi.fn(),
  updateDeadLetterJobStatus: vi.fn(),
  getDeadLetterJobs: vi.fn(),
  deleteDeadLetterJobsByStatus: vi.fn()
}

const mockQueue = {
  publish: vi.fn()
}

vi.mock('@/lib/database', () => ({ getDatabase: () => mockDatabase }))
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({ user: { id: 'admin' } })
}))
vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn().mockResolvedValue({ id: 'admin' })
}))
vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  })
}))

const sampleJob: DeadLetterJob = {
  id: 'job-1',
  jobName: 'createNote',
  payload: { id: 'msg-1', name: 'createNote', data: { foo: 'bar' } },
  errorMessage: 'Something broke',
  errorStack: 'Error: Something broke',
  attempts: 5,
  status: 'failed',
  createdAt: 1000,
  updatedAt: 1000
}

describe('Admin Queues Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getQueue).mockReturnValue(
      mockQueue as unknown as ReturnType<typeof getQueue>
    )
  })

  describe('retryDeadLetterJob', () => {
    it('publishes the job and updates status to retried', async () => {
      mockDatabase.getDeadLetterJobById.mockResolvedValue(sampleJob)
      mockQueue.publish.mockResolvedValue(undefined)
      mockDatabase.updateDeadLetterJobStatus.mockResolvedValue({
        ...sampleJob,
        status: 'retried'
      })

      const res = await retryDeadLetterJob('job-1')
      expect(res.success).toBe(true)
      expect(mockDatabase.getDeadLetterJobById).toHaveBeenCalledWith('job-1')
      expect(mockQueue.publish).toHaveBeenCalledWith(sampleJob.payload)
      expect(mockDatabase.updateDeadLetterJobStatus).toHaveBeenCalledWith(
        'job-1',
        'retried'
      )
    })

    it('returns error if job not found', async () => {
      mockDatabase.getDeadLetterJobById.mockResolvedValue(null)

      const res = await retryDeadLetterJob('job-missing')
      expect(res.success).toBe(false)
      expect(res.error).toBe('Job not found')
      expect(mockQueue.publish).not.toHaveBeenCalled()
    })
  })

  describe('discardDeadLetterJob', () => {
    it('updates status to discarded', async () => {
      mockDatabase.updateDeadLetterJobStatus.mockResolvedValue({
        ...sampleJob,
        status: 'discarded'
      })

      const res = await discardDeadLetterJob('job-1')
      expect(res.success).toBe(true)
      expect(mockDatabase.updateDeadLetterJobStatus).toHaveBeenCalledWith(
        'job-1',
        'discarded'
      )
    })
  })

  describe('retryAllDeadLetterJobs', () => {
    it('retries all failed jobs in batch', async () => {
      const job1 = { ...sampleJob, id: 'j1' }
      const job2 = { ...sampleJob, id: 'j2' }
      mockDatabase.getDeadLetterJobs.mockResolvedValue([job1, job2])
      mockQueue.publish.mockResolvedValue(undefined)
      mockDatabase.updateDeadLetterJobStatus.mockResolvedValue({})

      const res = await retryAllDeadLetterJobs()
      expect(res.success).toBe(true)
      expect(res.count).toBe(2)
      expect(mockQueue.publish).toHaveBeenCalledTimes(2)
      expect(mockDatabase.updateDeadLetterJobStatus).toHaveBeenCalledWith(
        'j1',
        'retried'
      )
      expect(mockDatabase.updateDeadLetterJobStatus).toHaveBeenCalledWith(
        'j2',
        'retried'
      )
    })
  })

  describe('clearDiscardedJobs', () => {
    it('deletes all discarded jobs', async () => {
      mockDatabase.deleteDeadLetterJobsByStatus.mockResolvedValue(5)

      const res = await clearDiscardedJobs()
      expect(res.success).toBe(true)
      expect(res.count).toBe(5)
      expect(mockDatabase.deleteDeadLetterJobsByStatus).toHaveBeenCalledWith(
        'discarded'
      )
    })
  })
})
