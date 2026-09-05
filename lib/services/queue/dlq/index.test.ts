import type { Client } from '@upstash/qstash'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getConfig } from '@/lib/config'

import { DatabaseDLQProvider } from './database'
import { getDLQProvider } from './index'
import { QStashDLQProvider } from './qstash'

const mockListMessages = vi.fn()
const mockRetry = vi.fn()
const mockDelete = vi.fn()
const MockClient = vi.fn().mockImplementation(function (this: unknown) {
  return {
    dlq: {
      listMessages: mockListMessages,
      retry: mockRetry,
      delete: mockDelete
    }
  }
})

vi.mock('@/lib/config')
vi.mock('@upstash/qstash', () => ({
  Client: MockClient
}))

describe('DLQ Providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockClient.mockImplementation(function (this: unknown) {
      return {
        dlq: {
          listMessages: mockListMessages,
          retry: mockRetry,
          delete: mockDelete
        }
      } as unknown as Client
    })
  })

  describe('getDLQProvider', () => {
    it('returns QStashDLQProvider when queue type is qstash', () => {
      // Clear memoize cache if needed
      getDLQProvider.cache.clear?.()
      vi.mocked(getConfig).mockReturnValue({
        queue: {
          type: 'qstash',
          url: 'https://example.com/queue',
          token: 'token',
          currentSigningKey: 'key',
          nextSigningKey: 'nextKey'
        }
      } as ReturnType<typeof getConfig>)

      const provider = getDLQProvider()
      expect(provider).toBeInstanceOf(QStashDLQProvider)
      expect(provider.type).toBe('qstash')
    })

    it('returns DatabaseDLQProvider when queue type is not qstash', () => {
      getDLQProvider.cache.clear?.()
      vi.mocked(getConfig).mockReturnValue({
        queue: {
          type: 'cloudtasks'
        }
      } as ReturnType<typeof getConfig>)

      const provider = getDLQProvider()
      expect(provider).toBeInstanceOf(DatabaseDLQProvider)
      expect(provider.type).toBe('database')
    })
  })

  describe('QStashDLQProvider', () => {
    const qstashConfig = {
      type: 'qstash' as const,
      url: 'https://example.com/queue',
      token: 'test-token',
      currentSigningKey: 'k1',
      nextSigningKey: 'k2'
    }

    it('formats messages and extracts json error and stack', async () => {
      const provider = new QStashDLQProvider(qstashConfig)

      mockListMessages.mockResolvedValue({
        messages: [
          {
            dlqId: 'dlq_1',
            messageId: 'msg_1',
            body: JSON.stringify({
              id: 'm1',
              name: 'sendMail',
              data: { to: 'a@b.com' }
            }),
            responseStatus: 500,
            responseBody: JSON.stringify({
              error: 'SMTP timeout',
              stack: 'Error: SMTP timeout\n  at mail.js:5'
            }),
            maxRetries: 3,
            createdAt: 1700000000000
          }
        ]
      })

      const res = await provider.getJobs()
      expect(res.total).toBe(1)
      expect(res.counts.failed).toBe(1)
      expect(res.jobs).toHaveLength(1)

      const job = res.jobs[0]
      expect(job.id).toBe('dlq_1')
      expect(job.jobName).toBe('sendMail')
      expect(job.errorMessage).toBe('SMTP timeout')
      expect(job.errorStack).toContain('mail.js:5')
      expect(job.attempts).toBe(4)
      expect(job.status).toBe('failed')
    })

    it('calls retry with dlqId', async () => {
      const provider = new QStashDLQProvider(qstashConfig)
      mockRetry.mockResolvedValue({})

      const res = await provider.retryJob('dlq_123')
      expect(res.success).toBe(true)
      expect(mockRetry).toHaveBeenCalledWith('dlq_123')
    })

    it('calls delete with dlqId', async () => {
      const provider = new QStashDLQProvider(qstashConfig)
      mockDelete.mockResolvedValue({})

      const res = await provider.discardJob('dlq_123')
      expect(res.success).toBe(true)
      expect(mockDelete).toHaveBeenCalledWith('dlq_123')
    })

    it('calls retry all', async () => {
      const provider = new QStashDLQProvider(qstashConfig)
      mockRetry.mockResolvedValue({
        responses: [{ messageId: 'm1' }, { messageId: 'm2' }]
      })

      const res = await provider.retryAll()
      expect(res.success).toBe(true)
      expect(res.count).toBe(2)
      expect(mockRetry).toHaveBeenCalledWith({ all: true })
    })

    it('orders messages by createdAt descending (last fail first)', async () => {
      const provider = new QStashDLQProvider(qstashConfig)

      mockListMessages.mockResolvedValue({
        messages: [
          {
            dlqId: 'dlq_old',
            messageId: 'msg_1',
            body: JSON.stringify({ id: 'm1', name: 'firstJob' }),
            createdAt: 1000
          },
          {
            dlqId: 'dlq_newest',
            messageId: 'msg_2',
            body: JSON.stringify({ id: 'm2', name: 'latestJob' }),
            createdAt: 3000
          },
          {
            dlqId: 'dlq_middle',
            messageId: 'msg_3',
            body: JSON.stringify({ id: 'm3', name: 'middleJob' }),
            createdAt: 2000
          }
        ]
      })

      const res = await provider.getJobs()
      expect(res.jobs).toHaveLength(3)
      expect(res.jobs[0].id).toBe('dlq_newest')
      expect(res.jobs[1].id).toBe('dlq_middle')
      expect(res.jobs[2].id).toBe('dlq_old')
    })

    it('calls clear all', async () => {
      const provider = new QStashDLQProvider(qstashConfig)
      mockDelete.mockResolvedValue({ deleted: 5 })

      const res = await provider.clearDiscarded()
      expect(res.success).toBe(true)
      expect(res.count).toBe(5)
      expect(mockDelete).toHaveBeenCalledWith({ all: true })
    })

    it('calls drop all', async () => {
      const provider = new QStashDLQProvider(qstashConfig)
      mockDelete.mockResolvedValue({ deleted: 8 })

      const res = await provider.dropAll()
      expect(res.success).toBe(true)
      expect(res.count).toBe(8)
      expect(mockDelete).toHaveBeenCalledWith({ all: true })
    })

    it('calls retryJobs with array of dlqIds', async () => {
      const provider = new QStashDLQProvider(qstashConfig)
      mockRetry.mockResolvedValue({
        responses: [{ messageId: 'm1' }, { messageId: 'm2' }]
      })

      const res = await provider.retryJobs(['dlq_1', 'dlq_2'])
      expect(res.success).toBe(true)
      expect(res.count).toBe(2)
      expect(mockRetry).toHaveBeenCalledWith({ dlqIds: ['dlq_1', 'dlq_2'] })
    })

    it('calls deleteJobs with array of dlqIds', async () => {
      const provider = new QStashDLQProvider(qstashConfig)
      mockDelete.mockResolvedValue({ deleted: 2 })

      const res = await provider.deleteJobs(['dlq_1', 'dlq_2'])
      expect(res.success).toBe(true)
      expect(res.count).toBe(2)
      expect(mockDelete).toHaveBeenCalledWith({ dlqIds: ['dlq_1', 'dlq_2'] })
    })
  })
})
