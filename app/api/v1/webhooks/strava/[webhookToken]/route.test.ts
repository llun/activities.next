import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { IMPORT_STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'

import { GET, POST } from './route'

type MockDatabase = Pick<Database, 'getFitnessSettingsByWebhookToken'>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockPublish = jest.fn()
jest.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    publish: (...args: unknown[]) => mockPublish(...args)
  })
}))

describe('Strava Webhook API', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getFitnessSettingsByWebhookToken: jest.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    jest.clearAllMocks()

    mockDb.getFitnessSettingsByWebhookToken.mockResolvedValue({
      id: 'fitness-settings-1',
      actorId: 'actor-1',
      serviceType: 'strava',
      webhookToken: 'token-123',
      accessToken: 'access-token',
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
          stravaActivityId: '987654'
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
})
