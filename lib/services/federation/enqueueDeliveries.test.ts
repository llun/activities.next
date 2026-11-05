import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/lib/database/types'
import { DELIVER_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'
import {
  enqueueDeliveries,
  getDeliveryJobId
} from '@/lib/services/federation/enqueueDeliveries'
import { setupRecordingTracer } from '@/lib/testing/recordingTracer'
import { logger } from '@/lib/utils/logger'
import { withSpan } from '@/lib/utils/trace'

const mockGetQueue = vi.fn()

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => mockGetQueue()
}))

describe('enqueueDeliveries', () => {
  let harness: ReturnType<typeof setupRecordingTracer>
  const publish = vi.fn()
  const getUnavailableInboxes = vi.fn()

  const mockDatabase = {
    getUnavailableInboxes
  } as unknown as Database

  beforeEach(() => {
    vi.clearAllMocks()
    harness = setupRecordingTracer()
    publish.mockResolvedValue(undefined)
    getUnavailableInboxes.mockResolvedValue([])
    mockGetQueue.mockReturnValue({
      runsInline: false,
      dropsDelayedJobs: false,
      publish,
      handle: vi.fn()
    })
  })

  afterEach(() => {
    harness.cleanup()
  })

  it('deduplicates inboxes, drops unavailable inboxes, and records skipped count on the span', async () => {
    getUnavailableInboxes.mockResolvedValue([
      'https://DEAD.example/users/test1/inbox',
      'https://dead.example/inbox'
    ])

    await withSpan('test', 'fanout', {}, async (span) => {
      await enqueueDeliveries({
        database: mockDatabase,
        parentMessageId: 'parent-1',
        actorId: 'https://llun.test/users/actor1',
        activity: { id: 'https://llun.test/statuses/1', type: 'Create' },
        inboxes: [
          'https://live.example/inbox',
          'https://live.example/inbox',
          'https://DEAD.example/users/test1/inbox',
          'https://dead.example/inbox',
          'https://dead.example/healthy-inbox'
        ],
        span,
        statusId: 'https://llun.test/statuses/1'
      })
    })

    expect(getUnavailableInboxes).toHaveBeenCalledWith({
      inboxes: [
        'https://live.example/inbox',
        'https://DEAD.example/users/test1/inbox',
        'https://dead.example/inbox',
        'https://dead.example/healthy-inbox'
      ]
    })
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith({
      id: getDeliveryJobId('parent-1', 'https://live.example/inbox'),
      name: DELIVER_ACTIVITY_JOB_NAME,
      data: {
        inbox: 'https://live.example/inbox',
        actorId: 'https://llun.test/users/actor1',
        activity: { id: 'https://llun.test/statuses/1', type: 'Create' }
      }
    })

    const span = harness.recordedSpans.find((s) => s.name === 'test.fanout')
    expect(span?.attributes['fanout.inbox_count']).toBe(2)
    expect(span?.attributes['fanout.skipped_unavailable_count']).toBe(2)
    const started = span?.events.find((e) => e.name === 'fanout_started')
    expect(started?.attributes?.['fanout.skipped_unavailable_count']).toBe(2)
  })

  it('proceeds with all inboxes and logs err when getUnavailableInboxes throws', async () => {
    const errorSpy = vi.spyOn(logger, 'error')
    getUnavailableInboxes.mockRejectedValue(new Error('lookup failed'))

    await enqueueDeliveries({
      database: mockDatabase,
      parentMessageId: 'parent-2',
      actorId: 'https://llun.test/users/actor1',
      activity: { id: 'https://llun.test/statuses/2', type: 'Create' },
      inboxes: ['https://one.example/inbox', 'https://two.example/inbox']
    })

    expect(publish).toHaveBeenCalledTimes(2)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'lookup failed' })
      }),
      'enqueueDeliveries: failed to read unavailable inboxes, proceeding without filter'
    )
    errorSpy.mockRestore()
  })
})
