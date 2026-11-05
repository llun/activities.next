import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Database } from '@/lib/database/types'
import { SalvageableDeliveryError } from '@/lib/services/federation/deliveryError'
import { setupRecordingTracer } from '@/lib/testing/recordingTracer'
import { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
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
    updateFollowStatus: vi.fn(),
    isDomainUnavailable: vi.fn(),
    recordDeliveryFailure: vi.fn(),
    clearDeliveryFailures: vi.fn()
  } as unknown as Database

  beforeEach(() => {
    vi.clearAllMocks()
    harness = setupRecordingTracer()
    vi.mocked(mockDatabase.getActorFromId).mockResolvedValue({
      id: 'https://activities.local/users/alice',
      privateKey: 'mock-key'
    } as unknown as Actor)
    vi.mocked(mockDatabase.isDomainUnavailable).mockResolvedValue(false)
    vi.mocked(mockDatabase.recordDeliveryFailure).mockResolvedValue(false)
    vi.mocked(mockDatabase.clearDeliveryFailures).mockResolvedValue(undefined)
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

  describe('domain availability tracking', () => {
    const baseMessage = {
      id: 'msg-track',
      name: 'DeliverActivityJob',
      data: {
        inbox: 'https://Remote.Example/inbox',
        actorId: 'https://activities.local/users/actor1',
        activity: { type: 'Create', id: 'https://activities.local/status/1' }
      }
    }

    it('skips delivery without sending a request or retrying when the domain is unavailable', async () => {
      const infoSpy = vi.spyOn(logger, 'info')
      vi.mocked(mockDatabase.isDomainUnavailable).mockResolvedValue(true)

      await expect(
        deliverActivityJob(mockDatabase, baseMessage)
      ).resolves.toBeUndefined()

      expect(mockDatabase.isDomainUnavailable).toHaveBeenCalledWith({
        domain: 'remote.example'
      })
      expect(request).not.toHaveBeenCalled()
      expect(mockDatabase.recordDeliveryFailure).not.toHaveBeenCalled()
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          inbox: 'https://Remote.Example/inbox',
          domain: 'remote.example'
        }),
        'DeliverActivityJob: skipping delivery to unavailable domain'
      )

      const span = harness.recordedSpans.find(
        (s) => s.name === 'job.DeliverActivityJob'
      )
      expect(span?.events.map((e) => e.name)).toContain(
        'delivery_skipped_unavailable_domain'
      )
      infoSpy.mockRestore()
    })

    it('records salvageable HTTP and network failures, logging warn once when the domain becomes unavailable', async () => {
      const warnSpy = vi.spyOn(logger, 'warn')
      vi.mocked(mockDatabase.recordDeliveryFailure).mockResolvedValueOnce(false)
      vi.mocked(request).mockResolvedValueOnce({
        statusCode: 503,
        body: 'Sensitive response body that must not be stored',
        headers: { 'set-cookie': 'secret' }
      })

      await expect(
        deliverActivityJob(mockDatabase, baseMessage)
      ).rejects.toBeInstanceOf(SalvageableDeliveryError)

      expect(mockDatabase.recordDeliveryFailure).toHaveBeenCalledTimes(1)
      expect(mockDatabase.recordDeliveryFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'remote.example',
          error: 'HTTP 503 is transient/salvageable'
        })
      )
      expect(warnSpy).not.toHaveBeenCalled()

      vi.mocked(mockDatabase.recordDeliveryFailure).mockResolvedValueOnce(true)
      const timeoutErr = Object.assign(new Error('timed out'), {
        code: 'ETIMEDOUT'
      })
      vi.mocked(request).mockRejectedValueOnce(timeoutErr)

      await expect(
        deliverActivityJob(mockDatabase, baseMessage)
      ).rejects.toBeInstanceOf(SalvageableDeliveryError)

      expect(mockDatabase.recordDeliveryFailure).toHaveBeenCalledTimes(2)
      expect(mockDatabase.recordDeliveryFailure).toHaveBeenLastCalledWith(
        expect.objectContaining({
          domain: 'remote.example',
          error: 'Network error ETIMEDOUT is transient/salvageable'
        })
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'remote.example',
          inbox: 'https://Remote.Example/inbox'
        }),
        'DeliverActivityJob: domain marked unavailable after repeated delivery failures'
      )
      warnSpy.mockRestore()
    })

    it.each([400, 403, 404, 410, 501])(
      'does not count unsalvageable HTTP %i toward domain unavailability',
      async (statusCode) => {
        vi.mocked(request).mockResolvedValue({
          statusCode,
          body: '',
          headers: {}
        })

        await expect(
          deliverActivityJob(mockDatabase, baseMessage)
        ).resolves.toBeUndefined()

        expect(mockDatabase.recordDeliveryFailure).not.toHaveBeenCalled()
      }
    )

    it('clears domain delivery failures on a 2xx response', async () => {
      vi.mocked(request).mockResolvedValue({
        statusCode: 202,
        body: '',
        headers: {}
      })

      await expect(
        deliverActivityJob(mockDatabase, baseMessage)
      ).resolves.toBeUndefined()

      expect(mockDatabase.clearDeliveryFailures).toHaveBeenCalledWith({
        domain: 'remote.example'
      })
    })

    it('logs tracking read/write errors with err and never changes delivery outcomes', async () => {
      const errorSpy = vi.spyOn(logger, 'error')

      vi.mocked(mockDatabase.isDomainUnavailable).mockRejectedValueOnce(
        new Error('db read down')
      )
      vi.mocked(mockDatabase.clearDeliveryFailures).mockRejectedValueOnce(
        new Error('db clear down')
      )
      vi.mocked(request).mockResolvedValueOnce({
        statusCode: 202,
        body: '',
        headers: {}
      })

      await expect(
        deliverActivityJob(mockDatabase, baseMessage)
      ).resolves.toBeUndefined()

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'remote.example',
          err: expect.objectContaining({ message: 'db read down' })
        }),
        'DeliverActivityJob: failed to check domain availability'
      )
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'remote.example',
          err: expect.objectContaining({ message: 'db clear down' })
        }),
        'DeliverActivityJob: failed to clear domain delivery failures'
      )

      vi.mocked(mockDatabase.recordDeliveryFailure).mockRejectedValueOnce(
        new Error('db write down')
      )
      vi.mocked(request).mockResolvedValueOnce({
        statusCode: 503,
        body: '',
        headers: {}
      })

      await expect(
        deliverActivityJob(mockDatabase, baseMessage)
      ).rejects.toBeInstanceOf(SalvageableDeliveryError)

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'remote.example',
          err: expect.objectContaining({ message: 'db write down' })
        }),
        'DeliverActivityJob: failed to record domain delivery failure'
      )

      errorSpy.mockRestore()
    })
  })
})
