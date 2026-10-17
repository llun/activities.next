import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Database } from '@/lib/database/types'
import { SalvageableDeliveryError } from '@/lib/services/federation/deliveryError'
import { setupRecordingTracer } from '@/lib/testing/recordingTracer'
import { Actor } from '@/lib/types/domain/actor'
import { request } from '@/lib/utils/request'

import {
  DeliverActivityJobData,
  deliverActivityJob
} from './deliverActivityJob'

vi.mock('@/lib/utils/request')
vi.mock('@/lib/activities/activityPubHeaders', () => ({
  activityPubRequestHeaders: vi.fn().mockReturnValue({
    'content-type': 'application/activity+json'
  })
}))

describe('deliverActivityJob', () => {
  let harness: ReturnType<typeof setupRecordingTracer>
  const mockDatabase = {
    getActorFromId: vi.fn(),
    getLocalFollowsFromInboxUrl: vi.fn(),
    updateFollowStatus: vi.fn()
  } as unknown as Database

  beforeEach(() => {
    vi.clearAllMocks()
    harness = setupRecordingTracer()
    vi.mocked(mockDatabase.getActorFromId).mockResolvedValue({
      id: 'https://activities.local/users/alice',
      privateKey: 'mock-key'
    } as unknown as Actor)
  })

  afterEach(() => {
    harness.cleanup()
  })

  it('validates job data with schema', () => {
    const valid = {
      inbox: 'https://remote.example/inbox',
      actorId: 'https://activities.local/users/alice',
      activity: { type: 'Create', id: 'https://activities.local/status/1' }
    }
    expect(DeliverActivityJobData.safeParse(valid).success).toBe(true)

    const invalid = {
      inbox: 'not-a-url',
      actorId: 'alice',
      activity: 'not-an-object'
    }
    expect(DeliverActivityJobData.safeParse(invalid).success).toBe(false)
  })

  it('completes cleanly on 200/202 success', async () => {
    vi.mocked(request).mockResolvedValue({
      statusCode: 200,
      body: '',
      headers: {}
    })

    const message = {
      id: 'msg-1',
      name: 'DeliverActivityJob',
      data: {
        inbox: 'https://remote.example/inbox',
        actorId: 'https://activities.local/users/alice',
        activity: { type: 'Create', id: 'https://activities.local/status/1' }
      }
    }

    await expect(
      deliverActivityJob(mockDatabase, message)
    ).resolves.toBeUndefined()

    const span = harness.recordedSpans.find(
      (s) => s.name === 'job.DeliverActivityJob'
    )
    expect(span).toBeDefined()
    const eventNames = span?.events.map((e) => e.name)
    expect(eventNames).toContain('delivery_attempt_start')
    expect(eventNames).toContain('delivery_success')
  })

  it('throws SalvageableDeliveryError on HTTP 503', async () => {
    vi.mocked(request).mockResolvedValue({
      statusCode: 503,
      body: 'Unavailable',
      headers: {}
    })

    const message = {
      id: 'msg-2',
      name: 'DeliverActivityJob',
      data: {
        inbox: 'https://remote.example/inbox',
        actorId: 'https://activities.local/users/alice',
        activity: { type: 'Create', id: 'https://activities.local/status/1' }
      }
    }

    await expect(deliverActivityJob(mockDatabase, message)).rejects.toThrow(
      SalvageableDeliveryError
    )

    const span = harness.recordedSpans.find(
      (s) => s.name === 'job.DeliverActivityJob'
    )
    expect(span).toBeDefined()
    const eventNames = span?.events.map((e) => e.name)
    expect(eventNames).toContain('delivery_attempt_start')
    expect(eventNames).toContain('delivery_salvageable_failure')
  })

  it('completes cleanly without throwing on unsalvageable HTTP 404 or 410', async () => {
    vi.mocked(request).mockResolvedValue({
      statusCode: 410,
      body: 'Gone',
      headers: {}
    })

    const message = {
      id: 'msg-3',
      name: 'DeliverActivityJob',
      data: {
        inbox: 'https://remote.example/inbox',
        actorId: 'https://activities.local/users/alice',
        activity: { type: 'Create', id: 'https://activities.local/status/1' }
      }
    }

    await expect(
      deliverActivityJob(mockDatabase, message)
    ).resolves.toBeUndefined()

    const span = harness.recordedSpans.find(
      (s) => s.name === 'job.DeliverActivityJob'
    )
    expect(span).toBeDefined()
    const eventNames = span?.events.map((e) => e.name)
    expect(eventNames).toContain('delivery_attempt_start')
    expect(eventNames).toContain('delivery_unsalvageable_discarded')
  })

  it('throws SalvageableDeliveryError on connection timeout', async () => {
    const err = new Error('Connection timed out') as NodeJS.ErrnoException
    err.code = 'ETIMEDOUT'
    vi.mocked(request).mockRejectedValue(err)

    const message = {
      id: 'msg-4',
      name: 'DeliverActivityJob',
      data: {
        inbox: 'https://remote.example/inbox',
        actorId: 'https://activities.local/users/alice',
        activity: { type: 'Create', id: 'https://activities.local/status/1' }
      }
    }

    await expect(deliverActivityJob(mockDatabase, message)).rejects.toThrow(
      SalvageableDeliveryError
    )

    const span = harness.recordedSpans.find(
      (s) => s.name === 'job.DeliverActivityJob'
    )
    expect(span).toBeDefined()
    const eventNames = span?.events.map((e) => e.name)
    expect(eventNames).toContain('delivery_attempt_start')
    expect(eventNames).toContain('delivery_salvageable_failure')
  })

  it('discards cleanly if actor is not found', async () => {
    vi.mocked(mockDatabase.getActorFromId).mockResolvedValue(null)

    const message = {
      id: 'msg-5',
      name: 'DeliverActivityJob',
      data: {
        inbox: 'https://remote.example/inbox',
        actorId: 'https://activities.local/users/missing',
        activity: { type: 'Create' }
      }
    }

    await expect(
      deliverActivityJob(mockDatabase, message)
    ).resolves.toBeUndefined()
    expect(request).not.toHaveBeenCalled()

    const span = harness.recordedSpans.find(
      (s) => s.name === 'job.DeliverActivityJob'
    )
    expect(span).toBeDefined()
    const eventNames = span?.events.map((e) => e.name)
    expect(eventNames).toContain('delivery_unsalvageable_discarded')
  })

  it.each([200, 201, 202, 204])('treats %i as delivered', async (code) => {
    vi.mocked(request).mockResolvedValue({
      statusCode: code,
      body: '',
      headers: {}
    })

    await expect(
      deliverActivityJob(mockDatabase, {
        id: `msg-${code}`,
        name: 'DeliverActivityJob',
        data: {
          inbox: 'https://remote.example/inbox',
          actorId: 'https://activities.local/users/alice',
          activity: { type: 'Create', id: 'https://activities.local/status/1' }
        }
      })
    ).resolves.toBeUndefined()

    const span = harness.recordedSpans.find(
      (s) => s.name === 'job.DeliverActivityJob'
    )
    expect(span?.events.map((e) => e.name)).toContain('delivery_success')
  })

  it.each(['ENOTFOUND', 'DEPTH_ZERO_SELF_SIGNED_CERT'])(
    'keeps follows and does not reject them on %s',
    async (code) => {
      const err = new Error('network failure') as NodeJS.ErrnoException
      err.code = code
      vi.mocked(request).mockRejectedValue(err)

      await expect(
        deliverActivityJob(mockDatabase, {
          id: 'msg-network',
          name: 'DeliverActivityJob',
          data: {
            inbox: 'https://bad-cert.example/inbox',
            actorId: 'https://activities.local/users/alice',
            activity: {
              type: 'Create',
              id: 'https://activities.local/status/1'
            }
          }
        })
      ).rejects.toBeInstanceOf(SalvageableDeliveryError)

      expect(mockDatabase.getLocalFollowsFromInboxUrl).not.toHaveBeenCalled()
      expect(mockDatabase.updateFollowStatus).not.toHaveBeenCalled()
    }
  )
})
