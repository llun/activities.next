import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { IMPORT_STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'

import { GET, POST } from './route'

type MockDatabase = Pick<Database, 'getFitnessSettingsByWebhookToken'>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockPublish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    publish: (...args: unknown[]) => mockPublish(...args)
  })
}))

const mockLoggerWarn = vi.fn()
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args)
  }
}))

describe('Strava Webhook API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessSettingsByWebhookToken: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()

    mockDb.getFitnessSettingsByWebhookToken.mockResolvedValue({
      id: 'fitness-settings-1',
      actorId: 'actor-1',
      serviceType: 'strava',
      webhookToken: 'token-123',
      accessToken: 'access-token',
      defaultVisibility: 'unlisted',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  })

  afterAll(() => {
    mockDatabase = null
  })

  it('verifies webhook challenge when token matches', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/webhooks/strava/token-123?hub.mode=subscribe&hub.verify_token=token-123&hub.challenge=challenge-value',
      {
        method: 'GET'
      }
    )

    const response = await GET(request, {
      params: Promise.resolve({ webhookToken: 'token-123' })
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data['hub.challenge']).toBe('challenge-value')
  })

  it('queues activity import on create activity events', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/webhooks/strava/token-123',
      {
        method: 'POST',
        body: JSON.stringify({
          object_type: 'activity',
          object_id: 987654,
          aspect_type: 'create',
          owner_id: 1,
          event_time: 1_735_689_600
        })
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ webhookToken: 'token-123' })
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: IMPORT_STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'actor-1',
          stravaActivityId: '987654',
          ownerId: 1,
          visibility: 'unlisted',
          // The webhook is the only entry point that opts into the import
          // email. Asserted explicitly so the feature cannot be switched off
          // by dropping this one field with a green build.
          notifyOnComplete: true,
          publishSendNote: true,
          // Same: the only entry point that stamps the post with the import
          // time instead of the ride's start time, and dropping the field
          // silently restores the backdating this flag exists to undo.
          postAtImportTime: true
        }
      })
    )
  })

  it('defaults webhook import visibility to private when unset', async () => {
    mockDb.getFitnessSettingsByWebhookToken.mockResolvedValueOnce({
      id: 'fitness-settings-1',
      actorId: 'actor-1',
      serviceType: 'strava',
      webhookToken: 'token-123',
      accessToken: 'access-token',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const request = new NextRequest(
      'http://llun.test/api/v1/webhooks/strava/token-123',
      {
        method: 'POST',
        body: JSON.stringify({
          object_type: 'activity',
          object_id: 13579,
          aspect_type: 'create',
          owner_id: 1,
          event_time: 1_735_689_600
        })
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ webhookToken: 'token-123' })
    })

    expect(response.status).toBe(200)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          actorId: 'actor-1',
          stravaActivityId: '13579',
          ownerId: 1,
          visibility: 'private',
          notifyOnComplete: true,
          publishSendNote: true,
          postAtImportTime: true
        }
      })
    )
  })

  it('falls back to private when persisted webhook visibility is invalid', async () => {
    mockDb.getFitnessSettingsByWebhookToken.mockResolvedValueOnce({
      id: 'fitness-settings-1',
      actorId: 'actor-1',
      serviceType: 'strava',
      webhookToken: 'token-123',
      accessToken: 'access-token',
      defaultVisibility: 'followers_only' as never,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const request = new NextRequest(
      'http://llun.test/api/v1/webhooks/strava/token-123',
      {
        method: 'POST',
        body: JSON.stringify({
          object_type: 'activity',
          object_id: 24680,
          aspect_type: 'create',
          owner_id: 1,
          event_time: 1_735_689_600
        })
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ webhookToken: 'token-123' })
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Invalid Strava default visibility; falling back to private',
        actorId: 'actor-1'
      })
    )
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          actorId: 'actor-1',
          stravaActivityId: '24680',
          ownerId: 1,
          visibility: 'private',
          notifyOnComplete: true,
          publishSendNote: true,
          postAtImportTime: true
        }
      })
    )
  })

  it('ignores non-create events without queueing imports', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/webhooks/strava/token-123',
      {
        method: 'POST',
        body: JSON.stringify({
          object_type: 'activity',
          object_id: 333,
          aspect_type: 'update',
          owner_id: 1,
          event_time: 1_735_689_600
        })
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ webhookToken: 'token-123' })
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.ignored).toBe(true)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  // The token is the endpoint's only credential. A log line carrying it hands
  // anyone with log access the ability to post events as Strava.
  it('never logs the webhook token, only a non-reversible fingerprint', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/webhooks/strava/token-123',
      {
        method: 'POST',
        body: JSON.stringify({ object_type: 'activity' })
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ webhookToken: 'token-123' })
    })

    expect(response.status).toBe(400)
    const logged = mockLoggerWarn.mock.calls.flat()
    expect(JSON.stringify(logged)).not.toContain('token-123')
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Invalid Strava webhook payload',
        webhookTokenFingerprint: expect.any(String)
      })
    )
  })

  // Strava delivers every athlete's events to the app's one subscription, so an
  // activity create event without an owner cannot be attributed to a
  // connection. It must be refused, not queued with the check skipped.
  it('rejects an activity create event without an owner_id', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/webhooks/strava/token-123',
      {
        method: 'POST',
        body: JSON.stringify({
          object_type: 'activity',
          object_id: 987654,
          aspect_type: 'create',
          event_time: 1_735_689_600
        })
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ webhookToken: 'token-123' })
    })

    expect(response.status).toBe(400)
    expect(mockPublish).not.toHaveBeenCalled()
  })
})
