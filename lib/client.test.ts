import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  getActorStatuses,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmaps,
  triggerFitnessRouteHeatmap,
  updateNote
} from './client'

enableFetchMocks()

describe('client updateNote', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    fetchMock.mockResponse(
      JSON.stringify({
        id: '123',
        content: '',
        created_at: '2026-04-26T10:00:00.000Z',
        edited_at: null,
        in_reply_to_id: null
      })
    )
  })

  it('omits empty status text for content-warning-only edits', async () => {
    await updateNote({
      statusId: '123',
      message: '',
      contentWarning: 'Updated warning'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/statuses/123',
      expect.objectContaining({
        body: JSON.stringify({
          spoiler_text: 'Updated warning'
        })
      })
    )
  })
})

describe('client getActorStatuses', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        origin: 'https://local.example'
      }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('throws when the remote statuses request fails', async () => {
    fetchMock.mockResponseOnce('', { status: 500 })

    await expect(
      getActorStatuses({
        actorId: 'https://remote.example/users/actor',
        pageUrl: 'https://remote.example/users/actor/outbox?page=true'
      })
    ).rejects.toThrow('Failed to load actor statuses: 500')
  })
})

describe('fitness route heatmap client calls', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        origin: 'http://llun.test'
      }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('preserves JSON error details when the focused route heatmap request fails', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ message: 'owner only' }), {
      status: 403
    })

    await expect(
      getFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        periodType: 'monthly',
        periodKey: '2026-04'
      })
    ).rejects.toThrow('Failed to load route heatmap (403): owner only')
  })

  it('preserves raw text error details when the route heatmap history request fails', async () => {
    fetchMock.mockResponseOnce('upstream unavailable', {
      status: 503,
      statusText: 'Service Unavailable'
    })

    await expect(
      getFitnessRouteHeatmaps({
        actorId: 'https://llun.test/users/test1'
      })
    ).rejects.toThrow(
      'Failed to load route heatmaps (503): upstream unavailable'
    )
  })

  it('sends an explicit retry flag when triggering a retry route heatmap job', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ queued: true }), {
      status: 202
    })

    await expect(
      triggerFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-04',
        region: 'netherlands',
        retry: true
      })
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          period_type: 'monthly',
          period_key: '2026-04',
          activity_type: 'running',
          region: 'netherlands',
          retry: true
        })
      })
    )
  })
})
