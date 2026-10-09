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

    it.each([
      {
        description: 'retryJob retries one message by dlqId',
        mock: mockRetry,
        mockResult: {},
        run: (provider: QStashDLQProvider) => provider.retryJob('dlq_123'),
        expectedCount: undefined,
        expectedArgs: 'dlq_123'
      },
      {
        description: 'discardJob deletes one message by dlqId',
        mock: mockDelete,
        mockResult: {},
        run: (provider: QStashDLQProvider) => provider.discardJob('dlq_123'),
        expectedCount: undefined,
        expectedArgs: 'dlq_123'
      },
      {
        description: 'retryAll retries every message and counts the responses',
        mock: mockRetry,
        mockResult: { responses: [{ messageId: 'm1' }, { messageId: 'm2' }] },
        run: (provider: QStashDLQProvider) => provider.retryAll(),
        expectedCount: 2,
        expectedArgs: { all: true }
      },
      {
        description: 'clearDiscarded deletes every message and counts them',
        mock: mockDelete,
        mockResult: { deleted: 5 },
        run: (provider: QStashDLQProvider) => provider.clearDiscarded(),
        expectedCount: 5,
        expectedArgs: { all: true }
      },
      {
        description: 'dropAll deletes every message and counts them',
        mock: mockDelete,
        mockResult: { deleted: 8 },
        run: (provider: QStashDLQProvider) => provider.dropAll(),
        expectedCount: 8,
        expectedArgs: { all: true }
      },
      {
        description: 'retryJobs retries an array of dlqIds',
        mock: mockRetry,
        mockResult: { responses: [{ messageId: 'm1' }, { messageId: 'm2' }] },
        run: (provider: QStashDLQProvider) =>
          provider.retryJobs(['dlq_1', 'dlq_2']),
        expectedCount: 2,
        expectedArgs: { dlqIds: ['dlq_1', 'dlq_2'] }
      },
      {
        description: 'deleteJobs deletes an array of dlqIds',
        mock: mockDelete,
        mockResult: { deleted: 2 },
        run: (provider: QStashDLQProvider) =>
          provider.deleteJobs(['dlq_1', 'dlq_2']),
        expectedCount: 2,
        expectedArgs: { dlqIds: ['dlq_1', 'dlq_2'] }
      }
    ])(
      '$description',
      async ({ mock, mockResult, run, expectedCount, expectedArgs }) => {
        const provider = new QStashDLQProvider(qstashConfig)
        mock.mockResolvedValue(mockResult)

        const res = await run(provider)

        expect(res.success).toBe(true)
        if (expectedCount !== undefined) {
          expect((res as { count: number }).count).toBe(expectedCount)
        }
        expect(mock).toHaveBeenCalledWith(expectedArgs)
      }
    )

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
  })
})
