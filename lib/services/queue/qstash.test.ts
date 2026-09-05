import {
  Context,
  TextMapGetter,
  TextMapPropagator,
  TextMapSetter,
  propagation
} from '@opentelemetry/api'
import type { Client } from '@upstash/qstash'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { QStashQueue } from './qstash'

const mockPublishJSON = vi.fn()
const MockClient = vi.fn().mockImplementation(function (this: unknown) {
  return {
    publishJSON: mockPublishJSON
  }
})

vi.mock('@upstash/qstash', () => ({
  Client: MockClient
}))
vi.mock('@/lib/utils/trace', () => ({
  withSpan: vi.fn(
    (
      _op: string,
      _name: string,
      _data: unknown,
      fn: (span: unknown) => unknown
    ) =>
      fn({
        setAttribute: vi.fn(),
        setStatus: vi.fn(),
        recordException: vi.fn()
      })
  )
}))

describe('QStashQueue', () => {
  beforeEach(() => {
    MockClient.mockClear()
    MockClient.mockImplementation(function (this: unknown) {
      return {
        publishJSON: mockPublishJSON
      } as unknown as Client
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

  it('injects active trace context into QStash publish headers when propagator is set', async () => {
    // Fake propagator that writes a dummy header
    const fakePropagator: TextMapPropagator = {
      inject(_ctx: Context, carrier: unknown, setter: TextMapSetter): void {
        setter.set(
          carrier as Record<string, string>,
          'traceparent',
          '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
        )
      },
      extract(
        _ctx: Context,
        _carrier: unknown,
        _getter: TextMapGetter
      ): Context {
        return _ctx
      },
      fields(): string[] {
        return ['traceparent']
      }
    }

    propagation.setGlobalPropagator(fakePropagator)

    const queue = new QStashQueue({
      type: 'qstash',
      url: 'https://example.com/queue',
      token: 'token',
      currentSigningKey: 'key',
      nextSigningKey: 'nextKey'
    })

    await queue.publish({
      id: 'job-1',
      name: 'sendNote',
      data: {}
    })

    expect(mockPublishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
        }
      })
    )

    propagation.disable()
  })
})
