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

  it('never queues a delivery to an empty inbox or a Bluesky actor', async () => {
    await enqueueDeliveries({
      database: mockDatabase,
      parentMessageId: 'msg-bsky',
      actorId: 'https://local.test/users/alice',
      activity: {},
      inboxes: [
        '',
        'https://bsky.app/profile/did:plc:abc',
        'https://bsky.app/profile/did:plc:abc/inbox'
      ]
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('never queues a delivery for an Announce, Undo Announce, or Delete targeting a Bluesky post', async () => {
    const blueskyPostId = `https://bsky.app/profile/did:plc:${'a'.repeat(24)}/post/3k`
    await enqueueDeliveries({
      database: mockDatabase,
      parentMessageId: 'msg-bsky-announce',
      actorId: 'https://local.test/users/alice',
      activity: {
        type: 'Announce',
        actor: 'https://local.test/users/alice',
        object: blueskyPostId
      },
      inboxes: ['https://live.example/inbox']
    })
    await enqueueDeliveries({
      database: mockDatabase,
      parentMessageId: 'msg-bsky-undo-announce',
      actorId: 'https://local.test/users/alice',
      activity: {
        type: 'Undo',
        actor: 'https://local.test/users/alice',
        object: {
          type: 'Announce',
          actor: 'https://local.test/users/alice',
          object: blueskyPostId
        }
      },
      inboxes: ['https://live.example/inbox']
    })
    await enqueueDeliveries({
      database: mockDatabase,
      parentMessageId: 'msg-bsky-delete-tombstone',
      actorId: 'https://local.test/users/alice',
      activity: {
        type: 'Delete',
        actor: 'https://local.test/users/alice',
        object: {
          id: blueskyPostId,
          type: 'Tombstone'
        }
      },
      inboxes: ['https://live.example/inbox']
    })
    await enqueueDeliveries({
      database: mockDatabase,
      parentMessageId: 'msg-bsky-delete-string',
      actorId: 'https://local.test/users/alice',
      activity: {
        type: 'Delete',
        actor: 'https://local.test/users/alice',
        object: blueskyPostId
      },
      inboxes: ['https://live.example/inbox']
    })

    expect(publish).not.toHaveBeenCalled()
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
