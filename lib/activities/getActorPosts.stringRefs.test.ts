import { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { clearServerSoftwareCache } from '@/lib/services/federation/serverSoftware'
import { ACTIVITY_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { Actor } from '@/lib/types/activitypub'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { getActorPosts } from './getActorPosts'

enableFetchMocks()

describe('getActorPosts', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
    clearServerSoftwareCache()
  })

  it('resolves string-referenced PeerTube Video objects from outbox', async () => {
    const actorId = 'https://framatube.org/accounts/framasoft'
    const videoUrl = 'https://framatube.org/videos/watch/abc'
    const outboxPageUrl = `${actorId}/outbox?page=true`
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${actorId}/outbox`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: outboxPageUrl
          })
        }
      }
      if (req.url === outboxPageUrl) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: outboxPageUrl,
            type: 'OrderedCollectionPage',
            partOf: `${actorId}/outbox`,
            orderedItems: [
              {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: 'https://framatube.org/videos/watch/abc/activity',
                type: 'Create',
                actor: actorId,
                to: [ACTIVITY_STREAM_PUBLIC],
                object: videoUrl
              }
            ]
          })
        }
      }
      if (req.url === videoUrl) {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/activity+json' },
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: videoUrl,
            type: 'Video',
            name: 'Framasoft Video',
            attributedTo: actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            content: '<p>A great video</p>',
            published: '2026-01-01T00:00:00Z',
            url: [
              {
                type: 'Link',
                mediaType: 'text/html',
                href: videoUrl
              },
              {
                type: 'Link',
                mediaType: 'video/mp4',
                href: 'https://framatube.org/static/webseed/abc.mp4'
              }
            ],
            icon: [
              {
                type: 'Image',
                url: 'https://framatube.org/static/thumbnails/abc.jpg'
              }
            ]
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response.statusesCount).toBe(1)
    expect(response.statuses).toHaveLength(1)
    const status = response.statuses[0]
    expect(status.type).toBe(StatusType.enum.Note)
    if (status.type !== StatusType.enum.Note) {
      throw new Error('Expected Note status')
    }
    expect(status.text).toContain('Framasoft Video')
    expect(status.attachments).toHaveLength(1)
    expect(status.attachments[0].mediaType).toBe('video/mp4')
    expect(status.attachments[0].url).toBe(
      'https://framatube.org/static/webseed/abc.mp4'
    )
    expect(status.attachments[0].thumbnailUrl).toBe(
      'https://framatube.org/static/thumbnails/abc.jpg'
    )
  })

  it('rejects cross-origin string-referenced objects in outbox', async () => {
    const actorId = 'https://framatube.org/accounts/framasoft'
    const videoUrl = 'https://framatube.org/videos/watch/abc'
    const evilNoteId = 'https://evil.example/videos/watch/abc'
    const outboxPageUrl = `${actorId}/outbox?page=true`
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${actorId}/outbox`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: outboxPageUrl
          })
        }
      }
      if (req.url === outboxPageUrl) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: outboxPageUrl,
            type: 'OrderedCollectionPage',
            partOf: `${actorId}/outbox`,
            orderedItems: [
              {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: 'https://framatube.org/videos/watch/abc/activity',
                type: 'Create',
                actor: actorId,
                to: [ACTIVITY_STREAM_PUBLIC],
                object: videoUrl
              }
            ]
          })
        }
      }
      if (req.url === videoUrl) {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/activity+json' },
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: evilNoteId,
            type: 'Video',
            attributedTo: actorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [],
            published: '2026-01-01T00:00:00Z',
            url: 'https://framatube.org/video.mp4'
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })
    expect(response.statuses).toHaveLength(0)
  })

  it('rejects string-referenced objects whose URL is cross-origin relative to person.id', async () => {
    const actorId = 'https://framatube.org/accounts/framasoft'
    const crossOriginUrl = 'https://other-instance.example/videos/watch/abc'
    const outboxPageUrl = `${actorId}/outbox?page=true`
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${actorId}/outbox`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: outboxPageUrl
          })
        }
      }
      if (req.url === outboxPageUrl) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: outboxPageUrl,
            type: 'OrderedCollectionPage',
            partOf: `${actorId}/outbox`,
            orderedItems: [
              {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: 'https://framatube.org/videos/watch/abc/activity',
                type: 'Create',
                actor: actorId,
                to: [ACTIVITY_STREAM_PUBLIC],
                object: crossOriginUrl
              }
            ]
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })
    expect(response.statuses).toHaveLength(0)
  })

  it('rejects local database status when status actorId does not match person.id', async () => {
    const actorId = 'https://framatube.org/accounts/framasoft'
    const otherActorId = 'https://framatube.org/accounts/otheruser'
    const statusId = 'https://framatube.org/videos/watch/123'
    const outboxPageUrl = `${actorId}/outbox?page=true`
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    // Status exists in database but belongs to otherActorId
    vi.spyOn(database, 'getStatus').mockResolvedValueOnce({
      id: statusId,
      url: statusId,
      actorId: otherActorId,
      actor: null,
      type: StatusType.enum.Note,
      text: 'Private other status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      edits: [],
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      attachments: [],
      tags: [],
      createdAt: 1000,
      updatedAt: 1000,
      isLocalActor: false
    })

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${actorId}/outbox`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: outboxPageUrl
          })
        }
      }
      if (req.url === outboxPageUrl) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: outboxPageUrl,
            type: 'OrderedCollectionPage',
            partOf: `${actorId}/outbox`,
            orderedItems: [
              {
                '@context': 'https://www.w3.org/ns/activitystreams',
                id: `${statusId}/activity`,
                type: 'Create',
                actor: actorId,
                to: [ACTIVITY_STREAM_PUBLIC],
                object: statusId
              }
            ]
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })
    expect(response.statuses).toHaveLength(0)
  })

  it('fetches and resolves Create activity where object is a string URI (PeerTube pattern)', async () => {
    const actorId = 'https://framatube.org/accounts/peertube'
    const videoUri = 'https://framatube.org/videos/watch/abc-123'
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${actorId}/outbox`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: `${actorId}/outbox?page=1`
          })
        }
      }

      if (req.url === `${actorId}/outbox?page=1`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            id: `${actorId}/outbox?page=1`,
            type: 'OrderedCollectionPage',
            partOf: `${actorId}/outbox`,
            orderedItems: [
              {
                id: `${actorId}/outbox/activity/1`,
                type: 'Create',
                actor: actorId,
                published: new Date().toISOString(),
                object: videoUri
              }
            ]
          })
        }
      }

      if (req.url === videoUri) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: videoUri,
            type: 'Video',
            attributedTo: actorId,
            to: ['https://www.w3.org/ns/activitystreams#Public'],
            cc: [],
            published: new Date().toISOString(),
            content: 'Watch my video',
            mediaType: 'text/markdown',
            url: [
              {
                type: 'Link',
                mediaType: 'video/mp4',
                href: 'https://framatube.org/video.mp4',
                width: 1920,
                height: 1080
              }
            ],
            icon: [
              {
                type: 'Image',
                url: 'https://framatube.org/thumb.jpg'
              }
            ]
          })
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })
    expect(response.statuses).toHaveLength(1)
    const status = response.statuses[0]
    expect(status.type).toBe(StatusType.enum.Note)
    if (status.type !== StatusType.enum.Note) {
      throw new Error('Expected Note status')
    }
    expect(status.id).toBe(videoUri)
    expect(status.attachments).toHaveLength(1)
    expect(status.attachments[0].url).toBe('https://framatube.org/video.mp4')
    expect(status.attachments[0].thumbnailUrl).toBe(
      'https://framatube.org/thumb.jpg'
    )
  })
})
