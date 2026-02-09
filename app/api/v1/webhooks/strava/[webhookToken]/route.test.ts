import { NextRequest } from 'next/server'

import { STRAVA_ACTIVITY_JOB_NAME } from '@/lib/jobs/names'

import { POST } from './route'

const mockGetDatabase = jest.fn()
jest.mock('../../../../../../lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

const mockPublish = jest.fn()
jest.mock('../../../../../../lib/services/queue', () => ({
  getQueue: () => ({
    publish: (...args: unknown[]) => mockPublish(...args)
  })
}))

jest.mock('../../../../../../lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}))

const flushAsync = async () => {
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('POST /api/v1/webhooks/strava/[webhookToken]', () => {
  const activityEventBody = {
    object_type: 'activity',
    object_id: 123,
    aspect_type: 'create',
    owner_id: 1,
    subscription_id: 10,
    event_time: Date.now()
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 200 without waiting for database lookup', async () => {
    mockGetDatabase.mockReturnValue(new Promise(() => {}))

    const request = new NextRequest(
      'http://llun.test/api/v1/webhooks/strava/token-1',
      {
        method: 'POST',
        body: JSON.stringify(activityEventBody)
      }
    )

    const result = await Promise.race<Response | 'timeout'>([
      POST(request, { params: Promise.resolve({ webhookToken: 'token-1' }) }),
      new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 50)
      )
    ])

    expect(result).not.toBe('timeout')
    if (result === 'timeout') return
    expect(result.status).toBe(200)
  })

  it('queues activity processing asynchronously after acknowledging request', async () => {
    mockGetDatabase.mockResolvedValue({
      getFitnessSettingsByWebhookToken: jest.fn().mockResolvedValue({
        actorId: 'https://llun.test/users/runner',
        accessToken: 'token'
      })
    })
    mockPublish.mockResolvedValue(undefined)

    const request = new NextRequest(
      'http://llun.test/api/v1/webhooks/strava/token-2',
      {
        method: 'POST',
        body: JSON.stringify(activityEventBody)
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ webhookToken: 'token-2' })
    })

    expect(response.status).toBe(200)

    await flushAsync()

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: STRAVA_ACTIVITY_JOB_NAME,
        data: {
          actorId: 'https://llun.test/users/runner',
          stravaActivityId: 123,
          aspectType: 'create'
        }
      })
    )
  })

  it('does not queue non-activity events', async () => {
    mockGetDatabase.mockResolvedValue({
      getFitnessSettingsByWebhookToken: jest.fn()
    })
    mockPublish.mockResolvedValue(undefined)

    const request = new NextRequest(
      'http://llun.test/api/v1/webhooks/strava/token-3',
      {
        method: 'POST',
        body: JSON.stringify({
          ...activityEventBody,
          object_type: 'athlete'
        })
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ webhookToken: 'token-3' })
    })

    expect(response.status).toBe(200)

    await flushAsync()

    expect(mockPublish).not.toHaveBeenCalled()
  })
})
