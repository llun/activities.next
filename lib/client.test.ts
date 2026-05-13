import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import {
  clearFitnessRouteHeatmaps,
  getActorStatuses,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmaps,
  triggerFitnessRouteHeatmap,
  updateNote,
  uploadAttachment
} from './client'

enableFetchMocks()

jest.mock('@/lib/utils/getMediaWidthAndHeight', () => ({
  getMediaWidthAndHeight: jest.fn().mockResolvedValue({ width: 10, height: 20 })
}))

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

  it('clears all route heatmaps for an actor', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ deleted: 3 }), { status: 200 })

    await expect(
      clearFitnessRouteHeatmaps({
        actorId: 'https://llun.test/users/test1'
      })
    ).resolves.toBe(3)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmaps',
      expect.objectContaining({
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      })
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

describe('client uploadAttachment presigned completion', () => {
  const presignedResponse = {
    presigned: {
      url: 'https://storage.example/upload',
      saveFileOutput: {
        id: 'media-1',
        type: 'image',
        mime_type: 'image/png',
        url: 'https://llun.test/api/v1/files/media-1.png',
        preview_url: null,
        text_url: null,
        remote_url: null,
        meta: {
          original: {
            width: 10,
            height: 20,
            size: '10x20',
            aspect: 0.5
          }
        },
        description: ''
      },
      headers: {
        'x-amz-meta-checksumsha1': 'checksum'
      }
    }
  }

  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('retries presigned upload completion after the file PUT succeeds', async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify(presignedResponse), { status: 200 })
      .mockResponseOnce('', { status: 200 })
      .mockResponseOnce('', { status: 503 })
      .mockResponseOnce('', { status: 503 })
      .mockResponseOnce(
        JSON.stringify({
          media: presignedResponse.presigned.saveFileOutput
        }),
        { status: 200 }
      )

    await expect(
      uploadAttachment(
        new File(['file-bytes'], 'photo.png', { type: 'image/png' })
      )
    ).resolves.toMatchObject({
      id: 'media-1',
      name: 'photo.png'
    })

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/medias/presigned',
      expect.objectContaining({ method: 'PATCH' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/v1/medias/presigned',
      expect.objectContaining({ method: 'PATCH' })
    )
  })

  it('cleans up pending media when presigned upload completion is exhausted', async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify(presignedResponse), { status: 200 })
      .mockResponseOnce('', { status: 200 })
      .mockResponseOnce('', { status: 503 })
      .mockResponseOnce('', { status: 503 })
      .mockResponseOnce('', { status: 503 })
      .mockResponseOnce(JSON.stringify({ success: true }), { status: 200 })

    await expect(
      uploadAttachment(
        new File(['file-bytes'], 'photo.png', { type: 'image/png' })
      )
    ).resolves.toBeNull()

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/accounts/media/media-1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})
