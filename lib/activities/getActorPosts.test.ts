import { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { clearServerSoftwareCache } from '@/lib/services/federation/serverSoftware'
import { ACTIVITY_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/activitypub'
import { AnnounceAction } from '@/lib/types/activitypub/activities'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { getActorPerson } from './getActorPerson'
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

  it('returns posts with total posts actor have', async () => {
    const person = (await getActorPerson({
      actorId: ACTOR1_ID
    })) as Actor
    const response = await getActorPosts({ database, person })
    expect(response).toMatchObject({
      statusesCount: 10,
      statuses: [
        {
          id: expect.stringContaining(ACTOR1_ID),
          actorId: ACTOR1_ID,
          isLocalActor: false,
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: expect.stringContaining(ACTOR1_ID),
          text: expect.toBeString()
        },
        {
          id: expect.stringContaining(ACTOR1_ID),
          actorId: ACTOR1_ID,
          isLocalActor: false,
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: expect.stringContaining(ACTOR1_ID),
          text: expect.toBeString()
        },
        {
          id: expect.stringContaining(ACTOR1_ID),
          actorId: ACTOR1_ID,
          isLocalActor: false,
          createdAt: expect.toBeNumber(),
          updatedAt: expect.toBeNumber(),
          type: 'Note',
          url: expect.stringContaining(ACTOR1_ID),
          text: expect.toBeString()
        }
      ]
    })
  })

  it('attaches a content-detected language to ephemeral outbox statuses', async () => {
    const actorId = 'https://detected-lang.example/users/actor'
    const statusId = `${actorId}/statuses/thai-content`
    const firstPageUrl = `${actorId}/outbox?page=true`
    const published = Date.now()
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
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: firstPageUrl
          })
        }
      }

      if (req.url === firstPageUrl) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            id: firstPageUrl,
            type: 'OrderedCollectionPage',
            partOf: `${actorId}/outbox`,
            orderedItems: [
              {
                id: `${statusId}/activity`,
                type: 'Create',
                actor: actorId,
                published: new Date(published).toISOString(),
                object: MockMastodonActivityPubNote({
                  id: statusId,
                  from: actorId,
                  // Declared English, but the content itself is
                  // unambiguously Thai.
                  content:
                    'สวัสดีครับ ผมชื่อจอห์น ผมเป็นนักพัฒนาซอฟต์แวร์ที่ทำงานในกรุงเทพมหานคร',
                  withContext: true
                })
              }
            ]
          })
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response.statuses).toHaveLength(1)
    expect(response.statuses[0]).toMatchObject({
      id: statusId,
      language: 'en',
      detectedLanguage: 'th'
    })
  })

  it('fetches a requested remote outbox page and returns pagination cursors', async () => {
    const actorId = 'https://paged.example/users/actor'
    const olderStatusId = `${actorId}/statuses/older`
    const nextPageUrl = `${actorId}/outbox/page/older`
    const prevPageUrl = `${actorId}/outbox?page=true&min_id=first`
    const published = Date.now()
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
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 30,
            first: `${actorId}/outbox?page=true`
          })
        }
      }

      if (req.url === nextPageUrl) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            id: nextPageUrl,
            type: 'OrderedCollectionPage',
            partOf: `${actorId}/outbox`,
            prev: prevPageUrl,
            orderedItems: [
              {
                id: `${olderStatusId}/activity`,
                type: 'Create',
                actor: actorId,
                published: new Date(published).toISOString(),
                object: MockMastodonActivityPubNote({
                  id: olderStatusId,
                  from: actorId,
                  content: 'Older page status',
                  withContext: true
                })
              }
            ]
          })
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({
      database,
      person,
      pageUrl: nextPageUrl
    })

    expect(response.statusesCount).toBe(30)
    expect(response.nextPageUrl).toBeNull()
    expect(response.prevPageUrl).toBe(prevPageUrl)
    expect(response.statuses).toHaveLength(1)
    expect(response.statuses[0].id).toBe(olderStatusId)
  })

  it('skips malformed remote outbox activities', async () => {
    const actorId = 'https://malformed.example/users/actor'
    const published = Date.now()
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
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 2,
            first: `${actorId}/outbox?page=true`
          })
        }
      }

      if (req.url === `${actorId}/outbox?page=true`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            id: `${actorId}/outbox?page=true`,
            type: 'OrderedCollectionPage',
            partOf: `${actorId}/outbox`,
            orderedItems: [
              {
                id: `${actorId}/statuses/bad-announce/activity`,
                type: AnnounceAction,
                actor: actorId,
                published: new Date(published).toISOString(),
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: []
              },
              {
                id: `${actorId}/statuses/bad-create/activity`,
                type: 'Create',
                actor: actorId,
                published: new Date(published).toISOString(),
                object: {
                  id: `${actorId}/statuses/bad-create`,
                  type: 'Note',
                  attributedTo: actorId,
                  to: [ACTIVITY_STREAM_PUBLIC],
                  cc: [],
                  content: [],
                  published: new Date(published).toISOString()
                }
              }
            ]
          })
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response).toMatchObject({
      statusesCount: 2,
      statuses: []
    })
  })

  it('handles inline orderedItems on OrderedCollection root without first page', async () => {
    const actorId = 'https://inline.example/users/actor'
    const statusId = `${actorId}/statuses/inline-1`
    const published = Date.now()
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
            orderedItems: [
              {
                id: `${statusId}/activity`,
                type: 'Create',
                actor: actorId,
                published: new Date(published).toISOString(),
                object: MockMastodonActivityPubNote({
                  id: statusId,
                  from: actorId,
                  content: 'Inline status text',
                  withContext: true
                })
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
    expect(response.statuses[0].id).toBe(statusId)
  })

  it('returns the one activity of an outbox page whose orderedItems is a bare object', async () => {
    const actorId = 'https://single.example/users/actor'
    const statusId = `${actorId}/statuses/single-1`
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
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: `${actorId}/outbox?page=true`
          })
        }
      }

      // A server that compacts its own JSON-LD collapses a one-element array
      // into the bare value.
      if (req.url === `${actorId}/outbox?page=true`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            id: `${actorId}/outbox?page=true`,
            type: 'OrderedCollectionPage',
            partOf: `${actorId}/outbox`,
            orderedItems: {
              id: `${statusId}/activity`,
              type: 'Create',
              actor: actorId,
              published: new Date().toISOString(),
              object: MockMastodonActivityPubNote({
                id: statusId,
                from: actorId,
                content: 'The only status',
                withContext: true
              })
            }
          })
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response.statuses.map((status) => status.id)).toEqual([statusId])
  })

  it('drops followers-only and direct notes a signer-filtered outbox handed back', async () => {
    const actorId = 'https://private.example/users/actor'
    const followersUrl = `${actorId}/followers`
    const publicId = `${actorId}/statuses/public`
    const unlistedId = `${actorId}/statuses/unlisted`
    const followersOnlyId = `${actorId}/statuses/followers-only`
    const directId = `${actorId}/statuses/direct`
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor
    const create = (
      id: string,
      to: string[],
      cc: string[]
    ): Record<string, unknown> => ({
      id: `${id}/activity`,
      type: 'Create',
      actor: actorId,
      to,
      cc,
      object: MockMastodonActivityPubNote({
        id,
        from: actorId,
        content: id,
        to,
        cc,
        withContext: true
      })
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
            totalItems: 4,
            orderedItems: [
              create(publicId, [ACTIVITY_STREAM_PUBLIC], [followersUrl]),
              create(unlistedId, [followersUrl], [ACTIVITY_STREAM_PUBLIC]),
              create(followersOnlyId, [followersUrl], []),
              create(directId, ['https://elsewhere.example/users/bob'], [])
            ]
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response.statuses.map((status) => status.id).sort()).toEqual(
      [publicId, unlistedId].sort()
    )
  })

  it('drops a stored non-public note the outbox references by id', async () => {
    const actorId = 'https://private.example/users/stored'
    const statusId = `${actorId}/statuses/stored-followers-only`
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    vi.spyOn(database, 'getStatus').mockResolvedValueOnce({
      id: statusId,
      url: statusId,
      actorId,
      actor: null,
      type: StatusType.enum.Note,
      text: 'Followers-only status',
      to: [`${actorId}/followers`],
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
            orderedItems: [
              {
                id: `${statusId}/activity`,
                type: 'Create',
                actor: actorId,
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
})
