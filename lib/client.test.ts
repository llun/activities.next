import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { urlToId } from '@/lib/utils/urlToId'

import {
  clearFitnessRouteHeatmaps,
  getActorStatuses,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmaps,
  startStravaArchiveImport,
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

  it('sends empty status text when clearing an edit message', async () => {
    await updateNote({
      statusId: '123',
      message: ''
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/statuses/123',
      expect.objectContaining({
        body: JSON.stringify({
          status: ''
        })
      })
    )
  })

  it('sends empty status text with media ids when clearing text during media edits', async () => {
    await updateNote({
      statusId: '123',
      message: '',
      attachments: [
        {
          type: 'upload',
          id: 'media-1',
          mediaType: 'image/jpeg',
          url: 'https://llun.test/api/v1/files/media-1.jpg',
          width: 640,
          height: 480,
          name: 'media-1.jpg'
        }
      ]
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/statuses/123',
      expect.objectContaining({
        body: JSON.stringify({
          status: '',
          media_ids: ['media-1']
        })
      })
    )
  })

  it('sends media ids for media-only edits', async () => {
    await updateNote({
      statusId: '123',
      attachments: [
        {
          type: 'upload',
          id: 'media-1',
          mediaType: 'image/jpeg',
          url: 'https://llun.test/api/v1/files/media-1.jpg',
          width: 640,
          height: 480,
          name: 'media-1.jpg'
        }
      ]
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/statuses/123',
      expect.objectContaining({
        body: JSON.stringify({
          media_ids: ['media-1']
        })
      })
    )
  })

  it('sends an empty media id list when all media is removed', async () => {
    await updateNote({
      statusId: '123',
      attachments: []
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/statuses/123',
      expect.objectContaining({
        body: JSON.stringify({
          media_ids: []
        })
      })
    )
  })

  it('encodes full status URLs before sending updates', async () => {
    const statusId = 'https://localhost:3001/users/test1/statuses/post-1'

    await updateNote({
      statusId,
      attachments: []
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/statuses/${urlToId(statusId)}`,
      expect.objectContaining({
        method: 'PUT'
      })
    )
  })

  it('returns server edit metadata for local timeline reconciliation', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: 'localhost:users:test1:statuses:post-1',
        uri: 'https://localhost/users/test1/statuses/post-1',
        content: '<p>Updated status</p>',
        text: 'Updated status',
        spoiler_text: '',
        created_at: '2026-04-26T10:00:00.000Z',
        edited_at: '2026-04-26T11:00:00.000Z',
        in_reply_to_id: null,
        media_attachments: [
          {
            id: 'server-attachment',
            type: 'image',
            url: 'https://localhost/api/v1/files/image.jpg',
            preview_url: null,
            remote_url: null,
            description: 'image.jpg',
            blurhash: null,
            meta: {
              original: {
                width: 640,
                height: 480,
                size: '640x480',
                aspect: 1.3333333333333333
              }
            }
          }
        ]
      })
    )

    await expect(
      updateNote({
        statusId: 'https://localhost/users/test1/statuses/post-1',
        message: 'Updated status'
      })
    ).resolves.toMatchObject({
      content: '<p>Updated status</p>',
      spoilerText: '',
      mediaAttachments: [
        expect.objectContaining({
          id: 'server-attachment'
        })
      ],
      status: {
        id: 'https://localhost/users/test1/statuses/post-1',
        text: 'Updated status',
        createdAt: new Date('2026-04-26T10:00:00.000Z').getTime(),
        updatedAt: new Date('2026-04-26T11:00:00.000Z').getTime(),
        reply: ''
      }
    })
  })

  it('throws an update-specific error when updating a note fails', async () => {
    fetchMock.mockResponseOnce('', { status: 500 })

    await expect(
      updateNote({
        statusId: '123',
        message: 'Updated status'
      })
    ).rejects.toThrow('Fail to update the note')
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
  let setTimeoutSpy: jest.SpyInstance

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
    setTimeoutSpy = jest
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((handler: Parameters<typeof setTimeout>[0]) => {
        if (typeof handler === 'function') {
          handler()
        }
        return 0 as unknown as ReturnType<typeof setTimeout>
      })
  })

  afterEach(() => {
    setTimeoutSpy.mockRestore()
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
    expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 250)
    expect(setTimeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 500)
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

  it('does not retry or clean up permanent presigned upload completion failures', async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify(presignedResponse), { status: 200 })
      .mockResponseOnce('', { status: 200 })
      .mockResponseOnce('', { status: 422 })

    await expect(
      uploadAttachment(
        new File(['file-bytes'], 'photo.png', { type: 'image/png' })
      )
    ).resolves.toBeNull()

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/medias/presigned',
      expect.objectContaining({ method: 'PATCH' })
    )
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/v1/accounts/media/media-1',
      expect.anything()
    )
  })

  it('cleans up pending media when presigned upload completion is unauthorized', async () => {
    fetchMock
      .mockResponseOnce(JSON.stringify(presignedResponse), { status: 200 })
      .mockResponseOnce('', { status: 200 })
      .mockResponseOnce('', { status: 401 })
      .mockResponseOnce(JSON.stringify({ success: true }), { status: 200 })

    await expect(
      uploadAttachment(
        new File(['file-bytes'], 'photo.png', { type: 'image/png' })
      )
    ).resolves.toBeNull()

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(setTimeoutSpy).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/accounts/media/media-1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})

describe('client startStravaArchiveImport', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('does not fall back to multipart upload when presigned setup is rejected', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'active import' }), {
      status: 409
    })

    await expect(
      startStravaArchiveImport(
        new File([Buffer.from('zip-data')], 'export.zip', {
          type: 'application/zip'
        }),
        'private'
      )
    ).rejects.toThrow('Failed to get presigned URL for archive')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/settings/fitness/strava/archive/presigned',
      expect.objectContaining({
        method: 'POST'
      })
    )
  })

  it('does not fall back to multipart upload when presigned import commit is rejected', async () => {
    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          presigned: {
            url: 'https://storage.example/archive.zip',
            fitnessFileId: 'fitness-file-1',
            archiveId: 'archive-1'
          }
        }),
        { status: 200 }
      )
      .mockResponseOnce('', { status: 200 })
      .mockResponseOnce(JSON.stringify({ error: 'active import' }), {
        status: 409
      })

    await expect(
      startStravaArchiveImport(
        new File([Buffer.from('zip-data')], 'export.zip', {
          type: 'application/zip'
        }),
        'private'
      )
    ).rejects.toThrow('Failed to start Strava archive import')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/settings/fitness/strava/archive',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    )
  })
})
