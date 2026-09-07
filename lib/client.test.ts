import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import type { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { generatePublicId } from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

import {
  ApiRequestError,
  addCollectionAccounts,
  approveCollectionMembership,
  bookmarkStatus,
  cancelActorDeletion,
  cancelFitnessRouteHeatmap,
  cancelStravaArchiveImport,
  changeAccountPassword,
  clearFitnessRouteHeatmaps,
  completeUploadPresignedUrl,
  createActor,
  createCollection,
  createDirectMessage,
  createFitnessGear,
  createFitnessGearComponent,
  createNote,
  createPoll,
  createReport,
  createStravaArchivePresignedUrl,
  createUploadPresignedUrl,
  deleteAccountMedia,
  deleteActor,
  deleteCollection,
  deleteFitnessFile,
  deleteFitnessGear,
  deleteFitnessGearComponent,
  deleteFitnessRouteHeatmap,
  deleteStatus,
  deleteStravaSettings,
  follow,
  getActiveStravaArchiveImport,
  getActorDomains,
  getActorMedia,
  getActorStatuses,
  getAppleMapsToken,
  getBookmarks,
  getCollectionFeed,
  getCollectionTimeline,
  getFavourites,
  getFitnessFilesByStatus,
  getFitnessGearActivities,
  getFitnessGearComponents,
  getFitnessGearList,
  getFitnessGeneralSettings,
  getFitnessImportBatch,
  getFitnessProcessingState,
  getFitnessRouteData,
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmapRegionNames,
  getFitnessRouteHeatmapTiles,
  getFitnessRouteHeatmaps,
  getFitnessSummary,
  getFollowStatus,
  getHashtagTimeline,
  getListTimeline,
  getMutes,
  getPublicHeatmapTiles,
  getStravaSettings,
  getTimeline,
  getTrendingLinks,
  getTrendingStatuses,
  getTrendingTags,
  likeStatus,
  refitFitnessGearComponent,
  regenerateFitnessMaps,
  removeCollectionAccounts,
  requestEmailChange,
  requestPasswordReset,
  resetPassword,
  retireFitnessGearComponent,
  retryAllFitnessImports,
  retryFitnessImportBatch,
  retryStravaArchiveImport,
  revokeCollectionMembership,
  revokeConnectedApp,
  saveStravaSettings,
  search,
  setDefaultActor,
  setFitnessGearRetired,
  setFitnessRouteHeatmapRegionName,
  shareFitnessRouteHeatmap,
  startFitnessImport,
  startStravaArchiveImport,
  submitOAuthConsent,
  switchActor,
  triggerFitnessRouteHeatmap,
  undoBookmarkStatus,
  unfollow,
  unshareFitnessRouteHeatmap,
  updateAccountName,
  updateCollection,
  updateFitnessFileGear,
  updateFitnessGear,
  updateFitnessGearComponent,
  updateFitnessGeneralSettings,
  updateNote,
  updateStatusVisibility,
  uploadAttachment,
  uploadFileToPresignedUrl,
  uploadFitnessFile,
  uploadMedia
} from './client'
import * as accountsModule from './client/accounts'
import * as fitnessFilesModule from './client/fitnessFiles'
import * as fitnessGearModule from './client/fitnessGear'
import * as fitnessGeneralSettingsModule from './client/fitnessGeneralSettings'
import * as fitnessHeatmapsModule from './client/fitnessHeatmaps'
import * as fitnessImportsModule from './client/fitnessImports'
import * as fitnessRoutesModule from './client/fitnessRoutes'
import * as httpModule from './client/http'
import * as mediaModule from './client/media'
import * as statusesModule from './client/statuses'
import * as timelinesModule from './client/timelines'

enableFetchMocks()

describe('client facade statuses re-exports', () => {
  it('re-exports extracted status functions', () => {
    expect(createNote).toBe(statusesModule.createNote)
    expect(updateNote).toBe(statusesModule.updateNote)
    expect(updateStatusVisibility).toBe(statusesModule.updateStatusVisibility)
    expect(createPoll).toBe(statusesModule.createPoll)
    expect(deleteStatus).toBe(statusesModule.deleteStatus)
    expect(getBookmarks).toBe(statusesModule.getBookmarks)
    expect(getFavourites).toBe(statusesModule.getFavourites)
  })
})

describe('client facade timelines re-exports', () => {
  it('re-exports extracted timeline functions', () => {
    expect(getTimeline).toBe(timelinesModule.getTimeline)
    expect(getHashtagTimeline).toBe(timelinesModule.getHashtagTimeline)
    expect(getListTimeline).toBe(timelinesModule.getListTimeline)
    expect(getCollectionTimeline).toBe(timelinesModule.getCollectionTimeline)
    expect(getCollectionFeed).toBe(timelinesModule.getCollectionFeed)
  })
})

describe('client facade media re-exports', () => {
  it('re-exports extracted media functions', () => {
    expect(uploadMedia).toBe(mediaModule.uploadMedia)
    expect(createUploadPresignedUrl).toBe(mediaModule.createUploadPresignedUrl)
    expect(uploadFileToPresignedUrl).toBe(mediaModule.uploadFileToPresignedUrl)
    expect(completeUploadPresignedUrl).toBe(
      mediaModule.completeUploadPresignedUrl
    )
    expect(uploadAttachment).toBe(mediaModule.uploadAttachment)
    expect(getActorMedia).toBe(mediaModule.getActorMedia)
  })
})

describe('client facade accounts re-exports', () => {
  it('re-exports extracted accounts functions', () => {
    expect(getMutes).toBe(accountsModule.getMutes)
    expect(revokeConnectedApp).toBe(accountsModule.revokeConnectedApp)
  })
})

describe('client facade fitness imports re-exports', () => {
  it('re-exports extracted fitness import functions', () => {
    expect(uploadFitnessFile).toBe(fitnessImportsModule.uploadFitnessFile)
    expect(startFitnessImport).toBe(fitnessImportsModule.startFitnessImport)
    expect(createStravaArchivePresignedUrl).toBe(
      fitnessImportsModule.createStravaArchivePresignedUrl
    )
    expect(startStravaArchiveImport).toBe(
      fitnessImportsModule.startStravaArchiveImport
    )
    expect(getActiveStravaArchiveImport).toBe(
      fitnessImportsModule.getActiveStravaArchiveImport
    )
    expect(retryStravaArchiveImport).toBe(
      fitnessImportsModule.retryStravaArchiveImport
    )
    expect(cancelStravaArchiveImport).toBe(
      fitnessImportsModule.cancelStravaArchiveImport
    )
  })
})

describe('client facade fitness files re-exports', () => {
  it('re-exports extracted fitness file functions', () => {
    expect(getFitnessImportBatch).toBe(fitnessFilesModule.getFitnessImportBatch)
    expect(retryFitnessImportBatch).toBe(
      fitnessFilesModule.retryFitnessImportBatch
    )
    expect(getFitnessProcessingState).toBe(
      fitnessFilesModule.getFitnessProcessingState
    )
    expect(getFitnessFilesByStatus).toBe(
      fitnessFilesModule.getFitnessFilesByStatus
    )
    expect(getAppleMapsToken).toBe(fitnessFilesModule.getAppleMapsToken)
  })
})

describe('client facade fitness general settings re-exports', () => {
  it('re-exports extracted fitness general settings functions', () => {
    expect(getFitnessGeneralSettings).toBe(
      fitnessGeneralSettingsModule.getFitnessGeneralSettings
    )
    expect(updateFitnessGeneralSettings).toBe(
      fitnessGeneralSettingsModule.updateFitnessGeneralSettings
    )
    expect(regenerateFitnessMaps).toBe(
      fitnessGeneralSettingsModule.regenerateFitnessMaps
    )
  })
})

describe('client facade fitness routes re-exports', () => {
  it('re-exports extracted fitness route and activity functions', () => {
    expect(getFitnessRouteData).toBe(fitnessRoutesModule.getFitnessRouteData)
    expect(retryAllFitnessImports).toBe(
      fitnessRoutesModule.retryAllFitnessImports
    )
    expect(getFitnessSummary).toBe(fitnessRoutesModule.getFitnessSummary)
    expect(deleteFitnessFile).toBe(fitnessRoutesModule.deleteFitnessFile)
  })
})

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
          in_reply_to_id: replyStatus.id
        })
      })
    )
  })

  it('recognizes an existing participant whose account id is a public id', async () => {
    // Post id flip an Account `id` is an opaque publicId, so the participant
    // check must join on `uri`. Getting it wrong re-mentions everyone who is
    // already on the thread.
    const replyStatus = {
      id: 'https://local.example/users/me/statuses/root',
      actorId: 'https://local.example/users/me',
      to: ['https://local.example/users/ada'],
      cc: ['https://local.example/users/me']
    } as Status
    const existingRecipient = {
      id: generatePublicId(),
      uri: 'https://local.example/users/ada',
      url: 'https://local.example/@ada',
      username: 'ada',
      acct: 'ada@local.example'
    } as MastodonAccount

    await createDirectMessage({
      message: 'hello',
      recipients: [existingRecipient],
      replyStatus
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/statuses',
      expect.objectContaining({
        body: JSON.stringify({
          status: 'hello',
          visibility: 'direct',
          in_reply_to_id: replyStatus.id
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

// Every id-accepting route resolves all three client-facing forms — a UUIDv7
// publicId, the legacy colon/`apurl_` encoding, and a raw AP URI — so the
// client must hand back whatever id it was given. Re-encoding is not merely
// redundant: `urlToId` parses a bare uuid as a URL host and returns it with a
// trailing colon, an id no resolver can decode. That silently broke the
// "Follow back" button once Account ids flipped to publicIds.
const PUBLIC_ID = generatePublicId()
const RAW_ACTOR_URI = 'https://remote.example/users/actor'
const RAW_STATUS_URI = 'https://remote.example/users/actor/statuses/post-1'

const ACTOR_ID_FORMS = [
  { description: 'public id', actorId: PUBLIC_ID, expected: PUBLIC_ID },
  {
    description: 'colon form',
    actorId: 'remote.example:users:actor',
    expected: 'remote.example:users:actor'
  },
  {
    description: 'raw AP URI',
    actorId: RAW_ACTOR_URI,
    expected: urlToId(RAW_ACTOR_URI)
  }
]

describe('client follow helpers', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    fetchMock.mockResponse('[]', { status: 200 })
  })

  it.each(ACTOR_ID_FORMS)(
    'follows and unfollows an account given a $description',
    async ({ actorId, expected }) => {
      await follow({ targetActorId: actorId })
      await unfollow({ targetActorId: actorId })

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        `/api/v1/accounts/${expected}/follow`,
        expect.objectContaining({ method: 'POST' })
      )
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `/api/v1/accounts/${expected}/unfollow`,
        expect.objectContaining({ method: 'POST' })
      )
    }
  )

  it.each(ACTOR_ID_FORMS)(
    'reads the relationship of an account given a $description',
    async ({ actorId }) => {
      await getFollowStatus({ targetActorId: actorId })

      // The relationships route reads `id[]` and resolves each entry itself, so
      // the id is only percent-escaped for the query string, never re-encoded.
      const requestUrl = new URL(
        fetchMock.mock.calls[0][0] as string,
        'https://local.example'
      )
      expect(requestUrl.pathname).toBe('/api/v1/accounts/relationships')
      expect(requestUrl.searchParams.get('id[]')).toBe(actorId)
    }
  )

  it('resolves a public id follow to true without mangling the id', async () => {
    fetchMock.mockResponseOnce('{}', { status: 200 })

    await expect(follow({ targetActorId: PUBLIC_ID })).resolves.toBe(true)
    expect(fetchMock.mock.calls[0][0]).not.toContain(`${PUBLIC_ID}:`)
  })
})

describe('client status id encoding', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    fetchMock.mockResponse('{}', { status: 200 })
  })

  it.each([
    { description: 'public id', statusId: PUBLIC_ID, expected: PUBLIC_ID },
    {
      description: 'colon form',
      statusId: 'remote.example:users:actor:statuses:post-1',
      expected: 'remote.example:users:actor:statuses:post-1'
    },
    {
      description: 'raw AP URI',
      statusId: RAW_STATUS_URI,
      expected: urlToId(RAW_STATUS_URI)
    }
  ])(
    'likes and deletes a status given a $description',
    async ({ statusId, expected }) => {
      await likeStatus({ statusId })
      await deleteStatus({ statusId })

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        `/api/v1/statuses/${expected}/favourite`,
        expect.objectContaining({ method: 'POST' })
      )
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `/api/v1/statuses/${expected}`,
        expect.objectContaining({ method: 'DELETE' })
      )
    }
  )

  it('sends report ids in the body without re-encoding them', async () => {
    await createReport({
      targetActorId: PUBLIC_ID,
      statusId: RAW_STATUS_URI,
      category: 'spam'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/reports',
      expect.objectContaining({
        body: JSON.stringify({
          account_id: PUBLIC_ID,
          status_ids: [RAW_STATUS_URI],
          category: 'spam'
        })
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

  // Cursors travel in a query param, where the accept side (decodeCursor →
  // safeIdToUrl, or the publicId fast path) takes every client-facing id form
  // verbatim. Re-encoding here would turn a publicId cursor into `<uuid>:`,
  // which resolves to nothing and silently ends pagination.
  it.each([
    {
      description: 'a raw ActivityPub URI',
      maxStatusId: 'https://remote.example/users/a/statuses/older',
      minStatusId: 'https://remote.example/users/a/statuses/newer'
    },
    {
      description: 'a UUIDv7 public id',
      maxStatusId: generatePublicId(),
      minStatusId: generatePublicId()
    },
    {
      description: 'a legacy colon-form id',
      maxStatusId: 'remote.example:users:a:statuses:older',
      minStatusId: 'remote.example:users:a:statuses:newer'
    }
  ])(
    'sends $description cursor unchanged for the timeline and feed helpers',
    async ({ maxStatusId, minStatusId }) => {
      fetchMock.mockResponse(
        JSON.stringify({
          statuses: [],
          nextMaxStatusId: null,
          prevMinStatusId: null
        }),
        { status: 200 }
      )

      // Parse the requested URL so the assertion is decoding-agnostic (`:` and
      // `/` are percent-escaped in the query string) and order-agnostic.
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
      expect(timelineUrl.searchParams.get('max_id')).toBe(maxStatusId)
      expect(timelineUrl.searchParams.get('min_id')).toBe(minStatusId)

      await getCollectionFeed({ collectionId: 'c1', maxStatusId, minStatusId })
      const feedUrl = lastRequestUrl()
      expect(feedUrl.pathname).toBe('/api/v1/collections/c1/feed')
      expect(feedUrl.searchParams.get('max_id')).toBe(maxStatusId)
      expect(feedUrl.searchParams.get('min_id')).toBe(minStatusId)
    }
  )
})

describe('client actor management helpers', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getActorDomains', () => {
    it('fetches allowed domains and host with GET and forwards abort signal', async () => {
      const controller = new AbortController()
      fetchMock.mockResponseOnce(
        JSON.stringify({
          domains: ['example.com', 'activities.local'],
          host: 'activities.local'
        }),
        { status: 200 }
      )

      const result = await getActorDomains({ signal: controller.signal })

      expect(result).toEqual({
        domains: ['example.com', 'activities.local'],
        host: 'activities.local'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/domains',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        })
      )
    })

    it('decodes API error message on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Unauthorized to view domains' }),
        { status: 401 }
      )

      await expect(getActorDomains()).rejects.toThrow(
        'Unauthorized to view domains'
      )
    })

    it('falls back to default error message on 500 without error body', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(getActorDomains()).rejects.toThrow(
        'Failed to fetch actor domains'
      )
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network error'))

      await expect(getActorDomains()).rejects.toThrow('Network error')
    })
  })

  describe('createActor', () => {
    it('sends POST with username and domain', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'new-actor-1',
          username: 'newuser',
          domain: 'activities.local'
        }),
        { status: 200 }
      )

      const result = await createActor({
        username: 'newuser',
        domain: 'activities.local'
      })

      expect(result).toEqual({
        id: 'new-actor-1',
        username: 'newuser',
        domain: 'activities.local'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'newuser',
            domain: 'activities.local'
          })
        })
      )
    })

    it('omits domain from request body when domain is undefined', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'new-actor-1',
          username: 'newuser',
          domain: 'activities.local'
        }),
        { status: 200 }
      )

      await createActor({ username: 'newuser' })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'newuser'
          })
        })
      )
    })

    it('preserves explicit empty string domain in request body for server validation', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          id: 'new-actor-1',
          username: 'newuser',
          domain: ''
        }),
        { status: 200 }
      )

      await createActor({ username: 'newuser', domain: '' })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'newuser',
            domain: ''
          })
        })
      )
    })

    it('decodes API error message when username exists', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Username already exists' }),
        { status: 400 }
      )

      await expect(
        createActor({ username: 'existing', domain: 'activities.local' })
      ).rejects.toThrow('Username already exists')
    })

    it('falls back to default error message when creating actor fails', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(
        createActor({ username: 'bob', domain: 'activities.local' })
      ).rejects.toThrow('Failed to create actor')
    })

    it('propagates network error', async () => {
      fetchMock.mockRejectOnce(new Error('Failed to fetch'))

      await expect(
        createActor({ username: 'bob', domain: 'activities.local' })
      ).rejects.toThrow('Failed to fetch')
    })
  })

  describe('cancelActorDeletion', () => {
    it('sends POST with actorId to cancel deletion', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          actorId: 'actor-1',
          status: 'cancelled'
        }),
        { status: 200 }
      )

      const result = await cancelActorDeletion({ actorId: 'actor-1' })

      expect(result).toEqual({
        actorId: 'actor-1',
        status: 'cancelled'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/cancel-deletion',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: 'actor-1' })
        })
      )
    })

    it('decodes API error message on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          error: 'Cannot cancel deletion that is already in progress'
        }),
        { status: 400 }
      )

      await expect(cancelActorDeletion({ actorId: 'actor-1' })).rejects.toThrow(
        'Cannot cancel deletion that is already in progress'
      )
    })

    it('falls back to default error message on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(cancelActorDeletion({ actorId: 'actor-1' })).rejects.toThrow(
        'Failed to cancel actor deletion'
      )
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network error'))

      await expect(cancelActorDeletion({ actorId: 'actor-1' })).rejects.toThrow(
        'Network error'
      )
    })
  })

  describe('switchActor', () => {
    it('sends POST with actorId and returns true on ok response', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200
      })

      const result = await switchActor({ actorId: 'actor-2' })

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/switch',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: 'actor-2' })
        })
      )
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce('', { status: 400 })

      const result = await switchActor({ actorId: 'actor-2' })

      expect(result).toBe(false)
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network disconnected'))

      await expect(switchActor({ actorId: 'actor-2' })).rejects.toThrow(
        'Network disconnected'
      )
    })
  })

  describe('setDefaultActor', () => {
    it('sends POST with actorId to set default actor', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          defaultActorId: 'actor-1',
          id: 'actor-1',
          username: 'alice',
          domain: 'activities.local'
        }),
        { status: 200 }
      )

      const result = await setDefaultActor({ actorId: 'actor-1' })

      expect(result).toEqual({
        defaultActorId: 'actor-1',
        id: 'actor-1',
        username: 'alice',
        domain: 'activities.local'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/default',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: 'actor-1' })
        })
      )
    })

    it('decodes API error message on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          error: 'Actor not found or not owned by account'
        }),
        { status: 404 }
      )

      await expect(
        setDefaultActor({ actorId: 'actor-missing' })
      ).rejects.toThrow('Actor not found or not owned by account')
    })

    it('falls back to default error message on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(setDefaultActor({ actorId: 'actor-1' })).rejects.toThrow(
        'Failed to update default actor'
      )
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network error'))

      await expect(setDefaultActor({ actorId: 'actor-1' })).rejects.toThrow(
        'Network error'
      )
    })
  })

  describe('deleteActor', () => {
    it('sends POST with actorId and delayDays', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          actorId: 'actor-1',
          status: 'scheduled',
          scheduledAt: '2026-09-10T00:00:00.000Z',
          immediate: false
        }),
        { status: 200 }
      )

      const result = await deleteActor({ actorId: 'actor-1', delayDays: 3 })

      expect(result).toEqual({
        actorId: 'actor-1',
        status: 'scheduled',
        scheduledAt: '2026-09-10T00:00:00.000Z',
        immediate: false
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/delete',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: 'actor-1', delayDays: 3 })
        })
      )
    })

    it('defaults delayDays to 0 when omitted', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          actorId: 'actor-1',
          status: 'scheduled',
          scheduledAt: null,
          immediate: true
        }),
        { status: 200 }
      )

      await deleteActor({ actorId: 'actor-1' })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/actors/delete',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId: 'actor-1', delayDays: 0 })
        })
      )
    })

    it('decodes API error message on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          error: 'Cannot delete the default actor'
        }),
        { status: 400 }
      )

      await expect(deleteActor({ actorId: 'actor-default' })).rejects.toThrow(
        'Cannot delete the default actor'
      )
    })

    it('falls back to default error message on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(deleteActor({ actorId: 'actor-1' })).rejects.toThrow(
        'Failed to delete actor'
      )
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network error'))

      await expect(deleteActor({ actorId: 'actor-1' })).rejects.toThrow(
        'Network error'
      )
    })
  })

  describe('deleteAccountMedia', () => {
    it('sends DELETE to account media route and returns true', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200
      })

      const result = await deleteAccountMedia({ mediaId: 'media-123' })

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/media/media-123',
        expect.objectContaining({
          method: 'DELETE'
        })
      )
    })

    it('encodes mediaId in path', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200
      })

      await deleteAccountMedia({ mediaId: 'path/with/slash' })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/media/path%2Fwith%2Fslash',
        expect.objectContaining({
          method: 'DELETE'
        })
      )
    })

    it('decodes API error message on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          error: 'Media not found or not owned by account'
        }),
        { status: 404 }
      )

      await expect(
        deleteAccountMedia({ mediaId: 'media-missing' })
      ).rejects.toThrow('Media not found or not owned by account')
    })

    it('falls back to default error message on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(deleteAccountMedia({ mediaId: 'media-1' })).rejects.toThrow(
        'Failed to delete media'
      )
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network error'))

      await expect(deleteAccountMedia({ mediaId: 'media-1' })).rejects.toThrow(
        'Network error'
      )
    })
  })

  describe('requestEmailChange', () => {
    it('requests email change with newEmail payload', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ message: 'Verification email sent' }),
        { status: 200 }
      )

      const result = await requestEmailChange({ newEmail: 'new@example.com' })

      expect(result).toEqual({ message: 'Verification email sent' })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/email',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newEmail: 'new@example.com' })
        })
      )
    })

    it('decodes API error message on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Email already in use' }),
        { status: 400 }
      )

      await expect(
        requestEmailChange({ newEmail: 'used@example.com' })
      ).rejects.toThrow('Email already in use')
    })

    it('falls back to default error message on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Internal Server Error', { status: 500 })

      await expect(
        requestEmailChange({ newEmail: 'fail@example.com' })
      ).rejects.toThrow('Failed to request email change')
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network failed'))

      await expect(
        requestEmailChange({ newEmail: 'net@example.com' })
      ).rejects.toThrow('Network failed')
    })
  })

  describe('updateAccountName', () => {
    it('updates account name with name payload', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ success: true }), {
        status: 200
      })

      const result = await updateAccountName({ name: 'Alice Wonderland' })

      expect(result).toEqual({ success: true })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/name',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Alice Wonderland' })
        })
      )
    })

    it('decodes API error message on validation failure', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Invalid name' }), {
        status: 422
      })

      await expect(
        updateAccountName({ name: 'x'.repeat(300) })
      ).rejects.toThrow('Invalid name')
    })

    it('falls back to default error message on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(updateAccountName({ name: 'Bob' })).rejects.toThrow(
        'Failed to update name'
      )
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Connection reset'))

      await expect(updateAccountName({ name: 'Bob' })).rejects.toThrow(
        'Connection reset'
      )
    })
  })

  describe('changeAccountPassword', () => {
    it('changes password with current and new password payload', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          message: 'Password changed successfully'
        }),
        { status: 200 }
      )

      const result = await changeAccountPassword({
        currentPassword: 'old-password',
        newPassword: 'new-password'
      })

      expect(result).toEqual({
        success: true,
        message: 'Password changed successfully'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/password',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword: 'old-password',
            newPassword: 'new-password'
          })
        })
      )
    })

    it('decodes API error when current password is incorrect', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Current password is incorrect' }),
        { status: 400 }
      )

      await expect(
        changeAccountPassword({
          currentPassword: 'wrong-password',
          newPassword: 'new-password'
        })
      ).rejects.toThrow('Current password is incorrect')
    })

    it('falls back to default error on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Bad Gateway', { status: 502 })

      await expect(
        changeAccountPassword({
          currentPassword: 'old-password',
          newPassword: 'new-password'
        })
      ).rejects.toThrow('Failed to change password')
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network timeout'))

      await expect(
        changeAccountPassword({
          currentPassword: 'old-password',
          newPassword: 'new-password'
        })
      ).rejects.toThrow('Network timeout')
    })
  })

  describe('requestPasswordReset', () => {
    it('requests password reset with email payload', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          message:
            'If an account exists for that email, a password reset link has been sent.'
        }),
        { status: 200 }
      )

      const result = await requestPasswordReset({
        email: 'test@example.com'
      })

      expect(result).toEqual({
        success: true,
        message:
          'If an account exists for that email, a password reset link has been sent.'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/password/reset/request',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com' })
        })
      )
    })

    it('decodes API error message on failure', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Bad Request' }), {
        status: 400
      })

      await expect(
        requestPasswordReset({ email: 'invalid-email' })
      ).rejects.toThrow('Bad Request')
    })

    it('falls back to default error message on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Server Error', { status: 500 })

      await expect(
        requestPasswordReset({ email: 'test@example.com' })
      ).rejects.toThrow('Failed to request password reset')
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network connection failed'))

      await expect(
        requestPasswordReset({ email: 'test@example.com' })
      ).rejects.toThrow('Network connection failed')
    })
  })

  describe('resetPassword', () => {
    it('resets password with code and newPassword payload', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          success: true,
          message: 'Password reset successfully'
        }),
        { status: 200 }
      )

      const result = await resetPassword({
        code: 'valid-reset-code',
        newPassword: 'new-password-123'
      })

      expect(result).toEqual({
        success: true,
        message: 'Password reset successfully'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/password/reset',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: 'valid-reset-code',
            newPassword: 'new-password-123'
          })
        })
      )
    })

    it('decodes API error when reset code is invalid or expired', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Invalid or expired reset code' }),
        { status: 400 }
      )

      await expect(
        resetPassword({
          code: 'expired-code',
          newPassword: 'new-password-123'
        })
      ).rejects.toThrow('Invalid or expired reset code')
    })

    it('falls back to default error on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Internal Server Error', { status: 500 })

      await expect(
        resetPassword({
          code: 'any-code',
          newPassword: 'new-password-123'
        })
      ).rejects.toThrow('Failed to reset password')
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network offline'))

      await expect(
        resetPassword({
          code: 'any-code',
          newPassword: 'new-password-123'
        })
      ).rejects.toThrow('Network offline')
    })
  })

  describe('submitOAuthConsent', () => {
    beforeEach(() => {
      fetchMock.resetMocks()
    })

    it('submits approval with exact keys and parses redirect response', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          redirect: true,
          url: 'https://client.example.com/callback?code=oauth-code'
        }),
        { status: 200 }
      )

      const result = await submitOAuthConsent({
        accept: true,
        scope: 'read write follow push',
        oauth_query: 'client_id=flow-test-client&response_type=code'
      })

      expect(result).toEqual({
        redirect: true,
        url: 'https://client.example.com/callback?code=oauth-code'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/oauth2/consent',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accept: true,
            scope: 'read write follow push',
            oauth_query: 'client_id=flow-test-client&response_type=code'
          })
        })
      )
    })

    it('submits denial with exact keys (omitting scope) and parses legacy redirect_uri', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          redirect: true,
          redirect_uri:
            'https://client.example.com/callback?error=access_denied'
        }),
        { status: 200 }
      )

      const result = await submitOAuthConsent({
        accept: false,
        oauth_query: 'client_id=flow-test-client&response_type=code'
      })

      expect(result).toEqual({
        redirect: true,
        redirect_uri: 'https://client.example.com/callback?error=access_denied'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/oauth2/consent',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accept: false,
            oauth_query: 'client_id=flow-test-client&response_type=code'
          })
        })
      )
    })

    it('decodes API error message on non-ok response', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'invalid_request: missing oauth query' }),
        { status: 400 }
      )

      await expect(
        submitOAuthConsent({
          accept: true,
          scope: 'read',
          oauth_query: ''
        })
      ).rejects.toThrow('invalid_request: missing oauth query')
    })

    it('falls back to default error on non-JSON failure', async () => {
      fetchMock.mockResponseOnce('Internal Server Error', { status: 500 })

      await expect(
        submitOAuthConsent({
          accept: true,
          scope: 'read',
          oauth_query: 'client_id=flow-test-client'
        })
      ).rejects.toThrow('Failed to submit consent')
    })

    it('propagates network failure', async () => {
      fetchMock.mockRejectOnce(new Error('Network error'))

      await expect(
        submitOAuthConsent({
          accept: false,
          oauth_query: 'client_id=flow-test-client'
        })
      ).rejects.toThrow('Network error')
    })
  })

  describe('Strava settings helpers', () => {
    beforeEach(() => {
      fetchMock.resetMocks()
    })

    describe('getStravaSettings', () => {
      it('fetches Strava settings with Accept header', async () => {
        fetchMock.mockResponseOnce(
          JSON.stringify({
            configured: true,
            actorId: 'https://local.example/users/alice',
            actorHandle: '@alice@local.example',
            clientId: '12345',
            connected: true,
            webhookUrl: 'https://local.example/api/v1/webhooks/strava/tok123',
            defaultVisibility: 'private'
          }),
          { status: 200 }
        )

        const result = await getStravaSettings()

        expect(result).toEqual({
          configured: true,
          actorId: 'https://local.example/users/alice',
          actorHandle: '@alice@local.example',
          clientId: '12345',
          connected: true,
          webhookUrl: 'https://local.example/api/v1/webhooks/strava/tok123',
          defaultVisibility: 'private'
        })
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/v1/fitness/strava',
          expect.objectContaining({
            method: 'GET',
            headers: {
              Accept: 'application/json'
            }
          })
        )
      })

      it('supports passing AbortSignal directly or via options object', async () => {
        fetchMock.mockResponse(
          JSON.stringify({
            configured: false,
            defaultVisibility: 'private'
          }),
          { status: 200 }
        )

        const controller1 = new AbortController()
        await getStravaSettings(controller1.signal)
        expect(fetchMock).toHaveBeenNthCalledWith(
          1,
          '/api/v1/fitness/strava',
          expect.objectContaining({ signal: controller1.signal })
        )

        const controller2 = new AbortController()
        await getStravaSettings({ signal: controller2.signal })
        expect(fetchMock).toHaveBeenNthCalledWith(
          2,
          '/api/v1/fitness/strava',
          expect.objectContaining({ signal: controller2.signal })
        )
      })

      it('throws server error message on non-ok response', async () => {
        fetchMock.mockResponseOnce(
          JSON.stringify({ error: 'Session expired' }),
          { status: 401 }
        )

        await expect(getStravaSettings()).rejects.toThrow('Session expired')
      })

      it('falls back to default error on non-JSON failure', async () => {
        fetchMock.mockResponseOnce('Server error', { status: 500 })

        await expect(getStravaSettings()).rejects.toThrow(
          'Failed to load settings'
        )
      })

      it('propagates cancellation / abort errors', async () => {
        const abortError = new Error('The user aborted a request.')
        abortError.name = 'AbortError'
        fetchMock.mockRejectOnce(abortError)

        await expect(getStravaSettings()).rejects.toThrow(
          'The user aborted a request.'
        )
      })
    })

    describe('saveStravaSettings', () => {
      it('posts credentials and visibility, returning authorizeUrl', async () => {
        fetchMock.mockResponseOnce(
          JSON.stringify({
            success: true,
            message: 'Strava settings saved successfully',
            authorizeUrl: '/api/v1/fitness/strava/authorize'
          }),
          { status: 200 }
        )

        const result = await saveStravaSettings({
          clientId: '12345',
          clientSecret: 'my-strava-secret',
          defaultVisibility: 'private'
        })

        expect(result).toEqual({
          success: true,
          message: 'Strava settings saved successfully',
          authorizeUrl: '/api/v1/fitness/strava/authorize'
        })
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/v1/fitness/strava',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId: '12345',
              clientSecret: 'my-strava-secret',
              defaultVisibility: 'private'
            })
          })
        )
      })

      it('posts only visibility when updating an already configured integration', async () => {
        fetchMock.mockResponseOnce(
          JSON.stringify({
            success: true,
            message: 'Strava import visibility saved successfully'
          }),
          { status: 200 }
        )

        const result = await saveStravaSettings({
          defaultVisibility: 'public'
        })

        expect(result).toEqual({
          success: true,
          message: 'Strava import visibility saved successfully'
        })
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/v1/fitness/strava',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              defaultVisibility: 'public'
            })
          })
        )
      })

      it('forwards optional signal to save request', async () => {
        fetchMock.mockResponseOnce(
          JSON.stringify({
            success: true,
            message: 'Saved'
          }),
          { status: 200 }
        )

        const controller = new AbortController()
        await saveStravaSettings({
          defaultVisibility: 'unlisted',
          signal: controller.signal
        })

        expect(fetchMock).toHaveBeenCalledWith(
          '/api/v1/fitness/strava',
          expect.objectContaining({
            signal: controller.signal
          })
        )
      })

      it('throws server error message on validation failure', async () => {
        fetchMock.mockResponseOnce(
          JSON.stringify({
            error: 'Client ID and Client Secret are required'
          }),
          { status: 400 }
        )

        await expect(
          saveStravaSettings({
            clientId: '12345'
          })
        ).rejects.toThrow('Client ID and Client Secret are required')
      })

      it('falls back to default error on non-JSON failure', async () => {
        fetchMock.mockResponseOnce('502 Bad Gateway', { status: 502 })

        await expect(
          saveStravaSettings({
            defaultVisibility: 'private'
          })
        ).rejects.toThrow('Failed to save settings')
      })

      it('propagates network failure', async () => {
        fetchMock.mockRejectOnce(new Error('Network disconnected'))

        await expect(
          saveStravaSettings({
            defaultVisibility: 'private'
          })
        ).rejects.toThrow('Network disconnected')
      })
    })

    describe('deleteStravaSettings', () => {
      it('sends DELETE request and returns confirmation message', async () => {
        fetchMock.mockResponseOnce(
          JSON.stringify({
            success: true,
            message: 'Strava settings removed successfully'
          }),
          { status: 200 }
        )

        const result = await deleteStravaSettings()

        expect(result).toEqual({
          success: true,
          message: 'Strava settings removed successfully'
        })
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/v1/fitness/strava',
          expect.objectContaining({
            method: 'DELETE'
          })
        )
      })

      it('forwards optional signal to delete request', async () => {
        fetchMock.mockResponseOnce(
          JSON.stringify({
            success: true,
            message: 'Strava settings removed successfully'
          }),
          { status: 200 }
        )

        const controller = new AbortController()
        await deleteStravaSettings({ signal: controller.signal })

        expect(fetchMock).toHaveBeenCalledWith(
          '/api/v1/fitness/strava',
          expect.objectContaining({
            signal: controller.signal
          })
        )
      })

      it('throws server error message on 404 or other failure', async () => {
        fetchMock.mockResponseOnce(
          JSON.stringify({ error: 'No Strava settings to remove' }),
          { status: 404 }
        )

        await expect(deleteStravaSettings()).rejects.toThrow(
          'No Strava settings to remove'
        )
      })

      it('falls back to default error on non-JSON failure', async () => {
        fetchMock.mockResponseOnce('500 Internal Error', { status: 500 })

        await expect(deleteStravaSettings()).rejects.toThrow(
          'Failed to remove settings'
        )
      })

      it('propagates network failure', async () => {
        fetchMock.mockRejectOnce(new Error('Network timeout'))

        await expect(deleteStravaSettings()).rejects.toThrow('Network timeout')
      })
    })
  })
})

describe('client facade exports', () => {
  it('re-exports ApiRequestError from http module', () => {
    expect(ApiRequestError).toBe(httpModule.ApiRequestError)
    const error = new ApiRequestError('Error message', 400)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error.status).toBe(400)
  })

  it('re-exports all fitness gear functions from fitnessGear module', () => {
    expect(getFitnessGearList).toBe(fitnessGearModule.getFitnessGearList)
    expect(createFitnessGear).toBe(fitnessGearModule.createFitnessGear)
    expect(updateFitnessGear).toBe(fitnessGearModule.updateFitnessGear)
    expect(deleteFitnessGear).toBe(fitnessGearModule.deleteFitnessGear)
    expect(setFitnessGearRetired).toBe(fitnessGearModule.setFitnessGearRetired)
    expect(getFitnessGearActivities).toBe(
      fitnessGearModule.getFitnessGearActivities
    )
    expect(getFitnessGearComponents).toBe(
      fitnessGearModule.getFitnessGearComponents
    )
    expect(createFitnessGearComponent).toBe(
      fitnessGearModule.createFitnessGearComponent
    )
    expect(updateFitnessGearComponent).toBe(
      fitnessGearModule.updateFitnessGearComponent
    )
    expect(deleteFitnessGearComponent).toBe(
      fitnessGearModule.deleteFitnessGearComponent
    )
    expect(retireFitnessGearComponent).toBe(
      fitnessGearModule.retireFitnessGearComponent
    )
    expect(refitFitnessGearComponent).toBe(
      fitnessGearModule.refitFitnessGearComponent
    )
    expect(updateFitnessFileGear).toBe(fitnessGearModule.updateFitnessFileGear)
  })

  it('re-exports all fitness heatmap functions from fitnessHeatmaps module', () => {
    expect(getFitnessRouteHeatmap).toBe(
      fitnessHeatmapsModule.getFitnessRouteHeatmap
    )
    expect(getFitnessRouteHeatmapTiles).toBe(
      fitnessHeatmapsModule.getFitnessRouteHeatmapTiles
    )
    expect(getPublicHeatmapTiles).toBe(
      fitnessHeatmapsModule.getPublicHeatmapTiles
    )
    expect(triggerFitnessRouteHeatmap).toBe(
      fitnessHeatmapsModule.triggerFitnessRouteHeatmap
    )
    expect(cancelFitnessRouteHeatmap).toBe(
      fitnessHeatmapsModule.cancelFitnessRouteHeatmap
    )
    expect(shareFitnessRouteHeatmap).toBe(
      fitnessHeatmapsModule.shareFitnessRouteHeatmap
    )
    expect(unshareFitnessRouteHeatmap).toBe(
      fitnessHeatmapsModule.unshareFitnessRouteHeatmap
    )
    expect(deleteFitnessRouteHeatmap).toBe(
      fitnessHeatmapsModule.deleteFitnessRouteHeatmap
    )
    expect(getFitnessRouteHeatmaps).toBe(
      fitnessHeatmapsModule.getFitnessRouteHeatmaps
    )
    expect(clearFitnessRouteHeatmaps).toBe(
      fitnessHeatmapsModule.clearFitnessRouteHeatmaps
    )
    expect(getFitnessRouteHeatmapRegionNames).toBe(
      fitnessHeatmapsModule.getFitnessRouteHeatmapRegionNames
    )
    expect(setFitnessRouteHeatmapRegionName).toBe(
      fitnessHeatmapsModule.setFitnessRouteHeatmapRegionName
    )
  })
})
