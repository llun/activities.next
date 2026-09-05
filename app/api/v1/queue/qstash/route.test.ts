import { SpanStatusCode } from '@opentelemetry/api'
import type { Receiver } from '@upstash/qstash'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getQueue } from '@/lib/services/queue'
import { setupRecordingTracer } from '@/lib/testing/recordingTracer'

import { POST } from './route'

const mockVerify = vi.fn()
const MockReceiver = vi.fn().mockImplementation(function (this: unknown) {
  return {
    verify: mockVerify
  }
})

vi.mock('@/lib/config')
vi.mock('@/lib/database')
vi.mock('@/lib/services/queue')
vi.mock('@upstash/qstash', () => ({
  Receiver: MockReceiver
}))

describe('POST /api/v1/queue/qstash', () => {
  let harness: ReturnType<typeof setupRecordingTracer>
  const mockHandle = vi.fn()
  const mockCreateDeadLetterJob = vi.fn()

  beforeEach(() => {
    harness = setupRecordingTracer()
    vi.clearAllMocks()

    vi.mocked(getConfig).mockReturnValue({
      queue: {
        type: 'qstash',
        url: 'https://example.com/queue',
        token: 'token',
        currentSigningKey: 'currentKey',
        nextSigningKey: 'nextKey',
        maxRetries: 3
      }
    } as ReturnType<typeof getConfig>)

    vi.mocked(getDatabase).mockReturnValue({
      createDeadLetterJob: mockCreateDeadLetterJob
    } as unknown as ReturnType<typeof getDatabase>)

    vi.mocked(getQueue).mockReturnValue({
      publish: vi.fn(),
      handle: mockHandle,
      runsInline: false
    } as unknown as ReturnType<typeof getQueue>)

    MockReceiver.mockImplementation(function (this: unknown) {
      return {
        verify: mockVerify
      } as unknown as Receiver
    })
  })

  afterEach(() => {
    harness.cleanup()
  })

  it('returns 404 if queue type is not qstash', async () => {
    vi.mocked(getConfig).mockReturnValue({
      queue: undefined
    } as ReturnType<typeof getConfig>)

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/qstash',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'test' })
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(404)
  })

  it('returns 400 if signature is invalid', async () => {
    mockVerify.mockResolvedValue(false)

    const request = new NextRequest(
      'https://activities.local/api/v1/queue/qstash',
      {
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
        headers: {
          'upstash-signature': 'invalid-signature'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
    expect(mockHandle).not.toHaveBeenCalled()
  })

  it('handles message and returns 200 on success', async () => {
    mockVerify.mockResolvedValue(true)
    mockHandle.mockResolvedValue(undefined)

    const body = { id: 'msg-1', name: 'testJob', data: { foo: 'bar' } }
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/qstash',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'upstash-signature': 'valid-signature'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(mockHandle).toHaveBeenCalledWith(body)
  })

  it('records exception on trace span and returns 500 when queue handle throws', async () => {
    mockVerify.mockResolvedValue(true)
    const queueError = new Error('Queue handle failure')
    mockHandle.mockRejectedValue(queueError)

    const body = { id: 'msg-err', name: 'testJob', data: {} }
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/qstash',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'upstash-signature': 'valid-signature'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(500)

    const spans = harness.recordedSpans
    const routeSpan = spans.find((s) => s.name === 'api.processQueueJob')
    expect(routeSpan).toBeDefined()
    expect(routeSpan?.exception).toBe(queueError)
    expect(routeSpan?.status?.code).toBe(SpanStatusCode.ERROR)
  })

  it('returns 500 on intermediate retry failure', async () => {
    mockVerify.mockResolvedValue(true)
    mockHandle.mockRejectedValue(new Error('Intermediate failure'))

    const body = { id: 'msg-retry', name: 'testJob', data: {} }
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/qstash',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'upstash-signature': 'valid-signature',
          'upstash-retried': '1'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(500)
    expect(mockCreateDeadLetterJob).not.toHaveBeenCalled()
  })

  it('returns 200 and captures record in dead_letter_jobs on terminal retry failure', async () => {
    mockVerify.mockResolvedValue(true)
    mockHandle.mockRejectedValue(new Error('Terminal failure'))
    mockCreateDeadLetterJob.mockResolvedValue({})

    const body = { id: 'msg-terminal', name: 'DeliverActivityJob', data: {} }
    const request = new NextRequest(
      'https://activities.local/api/v1/queue/qstash',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'upstash-signature': 'valid-signature',
          'upstash-retried': '3'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect(mockCreateDeadLetterJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: 'DeliverActivityJob',
        payload: body,
        errorMessage: 'Terminal failure',
        attempts: 4,
        status: 'failed'
      })
    )
  })
})
