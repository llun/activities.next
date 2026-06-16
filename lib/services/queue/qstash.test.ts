import { Client } from '@upstash/qstash'

import { QStashQueue } from './qstash'

vi.mock('@upstash/qstash')
vi.mock('@/lib/utils/trace', () => ({
  getTracer: () => ({
    startActiveSpan: vi.fn((name, callback) =>
      callback({
        recordException: vi.fn(),
        end: vi.fn()
      })
    )
  })
}))

describe('QStashQueue', () => {
  const mockPublishJSON = vi.fn()

  beforeEach(() => {
    ;(Client as unknown as jest.Mock).mockImplementation(function () {
      return {
        publishJSON: mockPublishJSON
      }
    })
    mockPublishJSON.mockClear()
  })

  it('uses message id as deduplicationId', async () => {
    const queue = new QStashQueue({
      type: 'qstash',
      url: 'https://example.com/queue',
      token: 'token',
      currentSigningKey: 'key',
      nextSigningKey: 'nextKey'
    })

    const message = {
      id: 'job:with:colons',
      name: 'test-job',
      data: {}
    }

    await queue.publish(message)

    expect(mockPublishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        deduplicationId: Buffer.from('job:with:colons').toString('base64url')
      })
    )
  })

  it('encodes simple id as well', async () => {
    const queue = new QStashQueue({
      type: 'qstash',
      url: 'https://example.com/queue',
      token: 'token',
      currentSigningKey: 'key',
      nextSigningKey: 'nextKey'
    })

    const message = {
      id: 'simple-job',
      name: 'test-job',
      data: {}
    }

    await queue.publish(message)

    expect(mockPublishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        deduplicationId: Buffer.from('simple-job').toString('base64url')
      })
    )
  })
})
