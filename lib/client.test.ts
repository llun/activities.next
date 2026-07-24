import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import type { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { urlToId } from '@/lib/utils/urlToId'

import {
  addCollectionAccounts,
  approveCollectionMembership,
  bookmarkStatus,
  cancelFitnessRouteHeatmap,
  clearFitnessRouteHeatmaps,
  createCollection,
  createDirectMessage,
  createPoll,
  deleteCollection,
  deleteFitnessRouteHeatmap,
  getActorStatuses,
  getBookmarks,
  getCollectionFeed,
  getCollectionTimeline,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmaps,
  getTrendingLinks,
  getTrendingStatuses,
  getTrendingTags,
  removeCollectionAccounts,
  revokeCollectionMembership,
  search,
  startStravaArchiveImport,
  triggerFitnessRouteHeatmap,
  undoBookmarkStatus,
  updateCollection,
  updateNote,
  uploadAttachment
} from './client'

enableFetchMocks()

vi.mock('@/lib/utils/getMediaWidthAndHeight', () => ({
  getMediaWidthAndHeight: vi.fn().mockResolvedValue({ width: 10, height: 20 })
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

describe('client createPoll', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  // The server's `{ error }` message carries the reason (e.g. an
  // admin-configured limit), so it is surfaced rather than replaced with a
  // generic failure; the fallback only applies when there is no message to show.
  it.each([
    {
      description: "surfaces the server's rejection message",
      body: JSON.stringify({ error: 'Poll cannot have more than 4 options' }),
      status: 422,
      expectedMessage: 'Poll cannot have more than 4 options'
    },
    {
      description: 'falls back to a generic message for an empty body',
      body: '',
      status: 500,
      expectedMessage: 'Fail to create a new poll'
    },
    {
      description: 'falls back to a generic message when there is no error key',
      body: JSON.stringify({ something: 'else' }),
      status: 422,
      expectedMessage: 'Fail to create a new poll'
    }
  ])('$description', async ({ body, status, expectedMessage }) => {
    fetchMock.mockResponse(body, { status })

    await expect(
      createPoll({
        message: 'Private poll without recipients',
        choices: ['A', 'B'],
        durationInSeconds: 300,
        visibility: 'direct'
      })
    ).rejects.toThrow(expectedMessage)
  })
})

describe('client createDirectMessage', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    fetchMock.mockResponse(JSON.stringify({ id: 'status-1' }), { status: 200 })
  })

  it('mentions extra reply recipients without duplicating existing participants', async () => {
    const replyStatus = {
      id: 'https://local.example/users/me/statuses/root',
      actorId: 'https://local.example/users/me',
      to: ['https://local.example/users/ada'],
      cc: ['https://local.example/users/me']
    } as Status
    const existingRecipientActorId = 'https://local.example/users/ada'
    const existingRecipient = {
      id: urlToId(existingRecipientActorId),
      url: 'https://local.example/@ada',
      username: 'ada',
      acct: 'ada@local.example'
    } as MastodonAccount
    const extraRecipient = {
      id: 'https://remote.example/users/bea',
      url: 'https://remote.example/users/bea',
      username: 'bea',
      acct: 'bea@remote.example'
    } as MastodonAccount

    await createDirectMessage({
      message: 'hello',
      recipients: [existingRecipient, extraRecipient],
      replyStatus
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/statuses',
      expect.objectContaining({
        body: JSON.stringify({
          status: '@bea@remote.example hello',
          visibility: 'direct',
          in_reply_to_id: urlToId(replyStatus.id)
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

describe('client bookmark helpers', () => {
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

  it('encodes full status URLs when bookmarking and unbookmarking', async () => {
    fetchMock.mockResponse('', { status: 200 })
    const statusId = 'https://remote.example/users/actor/statuses/post-1'

    await bookmarkStatus({ statusId })
    await undoBookmarkStatus({ statusId })

    const encodedStatusId = urlToId(statusId)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/v1/statuses/${encodedStatusId}/bookmark`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/statuses/${encodedStatusId}/unbookmark`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    )
  })

  it('loads bookmarks with activities_next format and bookmark cursors', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        statuses: [{ id: 'status-1' }],
        nextMaxBookmarkId: '10',
        prevMinBookmarkId: '12'
      }),
      { status: 200 }
    )

    await expect(
      getBookmarks({
        limit: 15,
        maxBookmarkId: '20',
        minBookmarkId: '30'
      })
    ).resolves.toEqual({
      statuses: [{ id: 'status-1' }],
      nextMaxBookmarkId: '10',
      prevMinBookmarkId: '12'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://local.example/api/v1/bookmarks?format=activities_next&limit=15&max_id=20&min_id=30',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    )
  })
})

describe('client search', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('builds the v2 search URL with typed filters and forwards abort signals', async () => {
    const abortController = new AbortController()
    fetchMock.mockResponseOnce(
      JSON.stringify({
        accounts: [],
        statuses: [{ id: 'status-1' }],
        hashtags: []
      }),
      { status: 200 }
    )

    await expect(
      search({
        q: 'trail run',
        type: 'statuses',
        limit: 10,
        offset: 20,
        resolve: true,
        signal: abortController.signal
      })
    ).resolves.toEqual({
      accounts: [],
      statuses: [{ id: 'status-1' }],
      hashtags: []
    })

    const [url, init] = fetchMock.mock.calls[0]
    const parsedUrl = new URL(url as string, 'https://local.example')
    expect(parsedUrl.pathname).toBe('/api/v2/search')
    expect(parsedUrl.searchParams.get('q')).toBe('trail run')
    expect(parsedUrl.searchParams.get('type')).toBe('statuses')
    expect(parsedUrl.searchParams.get('limit')).toBe('10')
    expect(parsedUrl.searchParams.get('offset')).toBe('20')
    expect(parsedUrl.searchParams.get('resolve')).toBe('true')
    expect(parsedUrl.searchParams.get('format')).toBe('activities_next')
    expect(init).toEqual(
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: abortController.signal
      })
    )
  })

  it('returns an empty result when the search response is not JSON', async () => {
    fetchMock.mockResponseOnce('<html>bad gateway</html>', { status: 200 })

    await expect(search({ q: 'trail' })).resolves.toEqual({
      accounts: [],
      statuses: [],
      hashtags: []
    })
  })

  it('throws a detailed error when the search request is rejected', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401
    })

    await expect(search({ q: 'trail' })).rejects.toThrow(
      'Search request failed (401): Unauthorized'
    )
  })

  it('throws raw response text when the search error response is not JSON', async () => {
    fetchMock.mockResponseOnce('Bad gateway', { status: 502 })

    await expect(search({ q: 'trail' })).rejects.toThrow(
      'Search request failed (502): Bad gateway'
    )
  })

  it('truncates long raw response text from failed search requests', async () => {
    const longResponseText = 'x'.repeat(250)
    fetchMock.mockResponseOnce(longResponseText, { status: 502 })

    await expect(search({ q: 'trail' })).rejects.toThrow(
      `Search request failed (502): ${'x'.repeat(200)}...`
    )
  })

  it('truncates long JSON messages from failed search requests', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ message: 'x'.repeat(250) }), {
      status: 502
    })

    await expect(search({ q: 'trail' })).rejects.toThrow(
      `Search request failed (502): ${'x'.repeat(200)}...`
    )
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

  it('removes a single route heatmap by key', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ deleted: true }), {
      status: 200
    })

    await expect(
      deleteFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-04',
        region: 'netherlands'
      })
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://llun.test/api/v1/accounts/llun.test:users:test1/fitness-route-heatmap?period_type=monthly&period_key=2026-04&activity_type=running&region=netherlands',
      expect.objectContaining({
        method: 'DELETE',
        headers: { Accept: 'application/json' }
      })
    )
  })

  it('throws a detailed error when removing a route heatmap fails', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'owner only' }), {
      status: 403
    })

    await expect(
      deleteFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        periodType: 'all_time',
        periodKey: 'all'
      })
    ).rejects.toThrow('Failed to load route heatmap (403): owner only')
  })

  it('sends a cancel flag when cancelling a route heatmap job', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ cancelled: true }), {
      status: 200
    })

    await expect(
      cancelFitnessRouteHeatmap({
        actorId: 'https://llun.test/users/test1',
        activityType: 'running',
        periodType: 'monthly',
        periodKey: '2026-04',
        region: 'netherlands'
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
          cancel: true
        })
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
    setTimeoutSpy = vi
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
      '/api/v1/fitness/strava/archive/presigned',
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
      '/api/v1/fitness/strava/archive',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    )
  })
})

describe('client trends', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('requests trending tags with a limit and returns the payload', async () => {
    const tags = [
      { name: 'gravel', url: 'https://llun.test/tags/gravel', history: [] }
    ]
    fetchMock.mockResponseOnce(JSON.stringify(tags), { status: 200 })

    await expect(getTrendingTags(10)).resolves.toEqual(tags)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/trends/tags?limit=10',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('omits the limit query when none is provided', async () => {
    fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

    await getTrendingTags()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/trends/tags',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('throws when trending statuses respond non-OK', async () => {
    fetchMock.mockResponseOnce('', { status: 503 })

    await expect(getTrendingStatuses(20)).rejects.toThrow(
      'Failed to load trending statuses: 503'
    )
    // The /explore Posts tab renders the interactive timeline post component,
    // so it opts into the app's domain status shape.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/trends/statuses?format=activities_next&limit=20',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('returns the domain trending statuses payload', async () => {
    const statuses = [{ id: 'https://llun.test/users/a/statuses/1' }]
    fetchMock.mockResponseOnce(JSON.stringify(statuses), { status: 200 })

    await expect(getTrendingStatuses()).resolves.toEqual(statuses)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/trends/statuses?format=activities_next',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('coerces a non-array trending statuses response to an empty list', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({}), { status: 200 })

    await expect(getTrendingStatuses()).resolves.toEqual([])
  })

  it('returns trending links from the payload', async () => {
    fetchMock.mockResponseOnce(JSON.stringify([]), { status: 200 })

    await expect(getTrendingLinks()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/trends/links',
      expect.objectContaining({ method: 'GET' })
    )
  })
})

describe('client collection helpers', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { origin: 'https://local.example' }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('creates a collection, forwarding feedEnabled as feed_enabled', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ collection: { id: 'c1', title: 'Builders' } }),
      {
        status: 200
      }
    )

    await expect(
      createCollection({
        title: 'Builders',
        description: 'who I read',
        topic: 'fediverse',
        visibility: 'public',
        feedEnabled: true
      })
    ).resolves.toEqual({ id: 'c1', title: 'Builders' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/collections',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      title: 'Builders',
      description: 'who I read',
      topic: 'fediverse',
      visibility: 'public',
      feed_enabled: true
    })
  })

  it('returns null when creating a collection fails', async () => {
    fetchMock.mockResponseOnce('', { status: 422 })
    await expect(createCollection({ title: 'x' })).resolves.toBeNull()
  })

  it('PATCHes only provided fields and forwards a null topic to clear it', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ collection: { id: 'c1' } }), {
      status: 200
    })

    await expect(
      updateCollection({
        collectionId: 'c1',
        title: 'Renamed',
        topic: null
      })
      // Mastodon 4.6 wraps the updated collection; the client unwraps it.
    ).resolves.toEqual({ id: 'c1' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/collections/c1',
      expect.objectContaining({ method: 'PATCH' })
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      title: 'Renamed',
      topic: null
    })
  })

  it('deletes a collection', async () => {
    fetchMock.mockResponseOnce('', { status: 200 })
    await expect(deleteCollection('c1')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/collections/c1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('adds and removes members via the items endpoint, skipping empty batches', async () => {
    fetchMock.mockResponse('', { status: 200 })

    await addCollectionAccounts({ collectionId: 'c1', accountIds: ['a1'] })
    await removeCollectionAccounts({ collectionId: 'c1', accountIds: ['a1'] })
    // An empty batch is a no-op that resolves true without hitting the network.
    await expect(
      addCollectionAccounts({ collectionId: 'c1', accountIds: [] })
    ).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/collections/c1/items',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/collections/c1/items',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('approves and revokes the caller’s own membership', async () => {
    fetchMock.mockResponse('', { status: 200 })

    await approveCollectionMembership({ collectionId: 'c1', accountId: 'me' })
    await revokeCollectionMembership({ collectionId: 'c1', accountId: 'me' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/collections/c1/items/me/approve',
      expect.objectContaining({ method: 'POST' })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/collections/c1/items/me/revoke',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('loads the owner timeline and the public feed in the activities_next shape', async () => {
    fetchMock.mockResponse(
      JSON.stringify({
        statuses: [{ id: 's1' }],
        nextMaxStatusId: '9',
        prevMinStatusId: '11'
      }),
      { status: 200 }
    )

    await expect(
      getCollectionTimeline({ collectionId: 'c1', limit: 20 })
    ).resolves.toEqual({
      statuses: [{ id: 's1' }],
      nextMaxStatusId: '9',
      prevMinStatusId: '11'
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://local.example/api/v1/timelines/collection/c1?format=activities_next&limit=20',
      expect.objectContaining({ method: 'GET' })
    )

    await getCollectionFeed({ collectionId: 'c1', limit: 20 })
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://local.example/api/v1/collections/c1/feed?format=activities_next&limit=20',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('encodes the cursor params with urlToId for the timeline and feed helpers', async () => {
    fetchMock.mockResponse(
      JSON.stringify({
        statuses: [],
        nextMaxStatusId: null,
        prevMinStatusId: null
      }),
      { status: 200 }
    )
    const maxStatusId = 'https://remote.example/users/a/statuses/older'
    const minStatusId = 'https://remote.example/users/a/statuses/newer'

    // Parse the requested URL so the assertion is decoding-agnostic (the `:` in
    // an encoded id is %3A-escaped in the query string) and order-agnostic.
    const lastRequestUrl = () =>
      new URL(
        fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string
      )

    await getCollectionTimeline({
      collectionId: 'c1',
      maxStatusId,
      minStatusId
    })
    const timelineUrl = lastRequestUrl()
    expect(timelineUrl.pathname).toBe('/api/v1/timelines/collection/c1')
    expect(timelineUrl.searchParams.get('max_id')).toBe(urlToId(maxStatusId))
    expect(timelineUrl.searchParams.get('min_id')).toBe(urlToId(minStatusId))

    await getCollectionFeed({ collectionId: 'c1', maxStatusId, minStatusId })
    const feedUrl = lastRequestUrl()
    expect(feedUrl.pathname).toBe('/api/v1/collections/c1/feed')
    expect(feedUrl.searchParams.get('max_id')).toBe(urlToId(maxStatusId))
    expect(feedUrl.searchParams.get('min_id')).toBe(urlToId(minStatusId))
  })
})
