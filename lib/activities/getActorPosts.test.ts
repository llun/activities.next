import { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { mockRequests } from '@/lib/stub/activities'
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

  it('keeps the boost actor on Announce and does not assign it to the original status', async () => {
    const boosterActorId = 'https://boost.example/users/booster'
    const originalActorId = 'https://origin.example/users/original'
    const originalStatusId = `${originalActorId}/statuses/original-1`
    const announceStatusId = `${boosterActorId}/statuses/announce-1/activity`
    const published = Date.now()

    const boosterActor = await database.createActor({
      actorId: boosterActorId,
      username: 'booster',
      domain: 'boost.example',
      followersUrl: `${boosterActorId}/followers`,
      inboxUrl: `${boosterActorId}/inbox`,
      sharedInboxUrl: 'https://boost.example/inbox',
      publicKey: 'public key',
      createdAt: published
    })
    if (!boosterActor) throw new Error('Failed to create booster actor')

    const person = MockActivityPubPerson({
      id: boosterActorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${boosterActorId}/outbox`) {
        return {
          status: 200,
          body: JSON.stringify({
            id: `${boosterActorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: `${boosterActorId}/outbox?page=true`
          })
        }
      }

      if (req.url === `${boosterActorId}/outbox?page=true`) {
        return {
          status: 200,
          body: JSON.stringify({
            id: `${boosterActorId}/outbox?page=true`,
            type: 'OrderedCollectionPage',
            partOf: `${boosterActorId}/outbox`,
            orderedItems: [
              {
                id: announceStatusId,
                type: AnnounceAction,
                actor: boosterActorId,
                published: new Date(published).toISOString(),
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: [`${boosterActorId}/followers`],
                object: originalStatusId
              }
            ]
          })
        }
      }

      if (req.url === originalStatusId) {
        return {
          status: 200,
          body: JSON.stringify(
            MockMastodonActivityPubNote({
              id: originalStatusId,
              from: originalActorId,
              content: 'Original status text',
              withContext: true
            })
          )
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })
    const announceStatus = response.statuses[0]

    expect(announceStatus.type).toBe(StatusType.enum.Announce)
    if (announceStatus.type !== StatusType.enum.Announce) {
      throw new Error('Expected Announce status')
    }

    expect(announceStatus.originalStatus.type).toBe(StatusType.enum.Note)
    if (announceStatus.originalStatus.type !== StatusType.enum.Note) {
      throw new Error('Expected Note status')
    }

    expect(announceStatus.actorId).toBe(boosterActorId)
    expect(announceStatus.actor?.id).toBe(boosterActorId)
    expect(announceStatus.originalStatus.actorId).toBe(originalActorId)
    expect(announceStatus.originalStatus.actor?.id).not.toBe(boosterActorId)
    expect(announceStatus.originalStatus.text).toBe('Original status text')
  })

  it('keeps Announce statuses when the boosted original status is already cached', async () => {
    const boosterActorId = 'https://boost-cached.example/users/booster'
    const originalActorId = 'https://origin-cached.example/users/original'
    const originalStatusId = `${originalActorId}/statuses/original-reply`
    const announceStatusId = `${boosterActorId}/statuses/announce-cached/activity`
    const published = Date.now()

    const boosterActor = await database.createActor({
      actorId: boosterActorId,
      username: 'booster',
      domain: 'boost-cached.example',
      followersUrl: `${boosterActorId}/followers`,
      inboxUrl: `${boosterActorId}/inbox`,
      sharedInboxUrl: 'https://boost-cached.example/inbox',
      publicKey: 'public key',
      createdAt: published
    })
    if (!boosterActor) throw new Error('Failed to create booster actor')

    await database.createNote({
      id: originalStatusId,
      url: originalStatusId,
      actorId: originalActorId,
      text: 'Cached original reply',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${originalActorId}/followers`],
      reply: `${originalActorId}/statuses/root`,
      createdAt: published - 1
    })

    const person = MockActivityPubPerson({
      id: boosterActorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${boosterActorId}/outbox`) {
        return {
          status: 200,
          body: JSON.stringify({
            id: `${boosterActorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: `${boosterActorId}/outbox?page=true`
          })
        }
      }

      if (req.url === `${boosterActorId}/outbox?page=true`) {
        return {
          status: 200,
          body: JSON.stringify({
            id: `${boosterActorId}/outbox?page=true`,
            type: 'OrderedCollectionPage',
            partOf: `${boosterActorId}/outbox`,
            orderedItems: [
              {
                id: announceStatusId,
                type: AnnounceAction,
                actor: boosterActorId,
                published: new Date(published).toISOString(),
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: [`${boosterActorId}/followers`],
                object: originalStatusId
              }
            ]
          })
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })
    const announceStatus = response.statuses[0]

    expect(announceStatus.type).toBe(StatusType.enum.Announce)
    if (announceStatus.type !== StatusType.enum.Announce) {
      throw new Error('Expected Announce status')
    }

    expect(announceStatus.originalStatus.type).toBe(StatusType.enum.Note)
    if (announceStatus.originalStatus.type !== StatusType.enum.Note) {
      throw new Error('Expected Note status')
    }

    expect(announceStatus.id).toBe(announceStatusId)
    expect(announceStatus.actorId).toBe(boosterActorId)
    expect(announceStatus.originalStatus.id).toBe(originalStatusId)
    expect(announceStatus.originalStatus.reply).toBe(
      `${originalActorId}/statuses/root`
    )
  })

  it('does not mutate cached original statuses when resolving boost actor profiles', async () => {
    const boosterActorId = 'https://boost-no-mutate.example/users/booster'
    const originalActorId = 'https://origin-no-mutate.example/users/original'
    const originalStatusId = `${originalActorId}/statuses/original`
    const announceStatusId = `${boosterActorId}/statuses/announce/activity`
    const published = Date.now()

    await database.createActor({
      actorId: boosterActorId,
      username: 'booster',
      domain: 'boost-no-mutate.example',
      followersUrl: `${boosterActorId}/followers`,
      inboxUrl: `${boosterActorId}/inbox`,
      sharedInboxUrl: 'https://boost-no-mutate.example/inbox',
      publicKey: 'public key',
      createdAt: published
    })
    await database.createActor({
      actorId: originalActorId,
      username: 'original',
      domain: 'origin-no-mutate.example',
      followersUrl: `${originalActorId}/followers`,
      inboxUrl: `${originalActorId}/inbox`,
      sharedInboxUrl: 'https://origin-no-mutate.example/inbox',
      publicKey: 'public key',
      createdAt: published
    })
    await database.createNote({
      id: originalStatusId,
      url: originalStatusId,
      actorId: originalActorId,
      text: 'Cached original status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${originalActorId}/followers`],
      reply: '',
      createdAt: published - 1
    })

    const cachedOriginalStatus = await database.getStatus({
      statusId: originalStatusId
    })
    if (!cachedOriginalStatus) {
      throw new Error('Failed to load cached original status')
    }
    cachedOriginalStatus.actor = null

    const getStatusSpy = vi
      .spyOn(database, 'getStatus')
      .mockResolvedValue(cachedOriginalStatus)

    const person = MockActivityPubPerson({
      id: boosterActorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${boosterActorId}/outbox`) {
        return {
          status: 200,
          body: JSON.stringify({
            id: `${boosterActorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: `${boosterActorId}/outbox?page=true`
          })
        }
      }

      if (req.url === `${boosterActorId}/outbox?page=true`) {
        return {
          status: 200,
          body: JSON.stringify({
            id: `${boosterActorId}/outbox?page=true`,
            type: 'OrderedCollectionPage',
            partOf: `${boosterActorId}/outbox`,
            orderedItems: [
              {
                id: announceStatusId,
                type: AnnounceAction,
                actor: boosterActorId,
                published: new Date(published).toISOString(),
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: [`${boosterActorId}/followers`],
                object: originalStatusId
              }
            ]
          })
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    try {
      const response = await getActorPosts({ database, person })
      const announceStatus = response.statuses[0]

      expect(announceStatus.type).toBe(StatusType.enum.Announce)
      if (announceStatus.type !== StatusType.enum.Announce) {
        throw new Error('Expected Announce status')
      }

      expect(announceStatus.originalStatus.actor).toMatchObject({
        id: originalActorId
      })
      expect(cachedOriginalStatus.actor).toBeNull()
    } finally {
      getStatusSpy.mockRestore()
    }
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

  it('loads boosted original actor profiles for opaque actor ids', async () => {
    const boosterActorId = 'https://boost-bsky.example/users/booster'
    const originalActorId =
      'https://bsky.brid.gy/ap/did:plc:2gkh62xvzokhlf6li4ol3b3d'
    const originalStatusId =
      'https://bsky.brid.gy/convert/ap/at://did:plc:2gkh62xvzokhlf6li4ol3b3d/app.bsky.feed.post/3mknrszqses2y'
    const announceStatusId = `${boosterActorId}/statuses/announce-bridgy/activity`
    const published = Date.now()

    const boosterActor = await database.createActor({
      actorId: boosterActorId,
      username: 'booster',
      domain: 'boost-bsky.example',
      followersUrl: `${boosterActorId}/followers`,
      inboxUrl: `${boosterActorId}/inbox`,
      sharedInboxUrl: 'https://boost-bsky.example/inbox',
      publicKey: 'public key',
      createdAt: published
    })
    if (!boosterActor) throw new Error('Failed to create booster actor')

    await database.createActor({
      actorId: originalActorId,
      username: 'did:plc:2gkh62xvzokhlf6li4ol3b3d',
      domain: 'bsky.brid.gy',
      followersUrl: `${originalActorId}/followers`,
      inboxUrl: `${originalActorId}/inbox`,
      sharedInboxUrl: 'https://bsky.brid.gy/inbox',
      publicKey: 'stale public key',
      createdAt: published
    })

    const person = MockActivityPubPerson({
      id: boosterActorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${boosterActorId}/outbox`) {
        return {
          status: 200,
          body: JSON.stringify({
            id: `${boosterActorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 1,
            first: `${boosterActorId}/outbox?page=true`
          })
        }
      }

      if (req.url === `${boosterActorId}/outbox?page=true`) {
        return {
          status: 200,
          body: JSON.stringify({
            id: `${boosterActorId}/outbox?page=true`,
            type: 'OrderedCollectionPage',
            partOf: `${boosterActorId}/outbox`,
            orderedItems: [
              {
                id: announceStatusId,
                type: AnnounceAction,
                actor: boosterActorId,
                published: new Date(published).toISOString(),
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: [`${boosterActorId}/followers`],
                object: originalStatusId
              }
            ]
          })
        }
      }

      if (req.url === originalStatusId) {
        return {
          status: 200,
          body: JSON.stringify({
            id: originalStatusId,
            type: 'Note',
            url: [
              'https://bsky.brid.gy/r/https://bsky.app/profile/did:plc:2gkh62xvzokhlf6li4ol3b3d/post/3mknrszqses2y',
              {
                href: 'at://did:plc:2gkh62xvzokhlf6li4ol3b3d/app.bsky.feed.post/3mknrszqses2y',
                rel: 'canonical',
                type: 'Link'
              }
            ],
            attributedTo: originalActorId,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [`${originalActorId}/followers`],
            content: 'Original Bridgy status text',
            published: new Date(published).toISOString()
          })
        }
      }

      if (req.url === originalActorId) {
        return {
          status: 200,
          body: JSON.stringify({
            id: originalActorId,
            type: 'Person',
            following: `${originalActorId}/following`,
            followers: `${originalActorId}/followers`,
            inbox: `${originalActorId}/inbox`,
            outbox: `${originalActorId}/outbox`,
            featured: {
              id: `${originalActorId}/collections/featured`,
              type: 'OrderedCollection'
            },
            preferredUsername: 'patak.cat',
            name: 'patak',
            summary: '',
            url: [
              'https://bsky.brid.gy/r/https://bsky.app/profile/patak.cat',
              {
                href: 'https://patak.cat/',
                rel: 'canonical',
                type: 'Link'
              },
              'https://patak.cat/'
            ],
            image: [
              {
                type: 'Image',
                url: 'https://cdn.example/header.jpg'
              }
            ],
            tag: {
              type: 'Hashtag',
              href: 'https://bsky.brid.gy/tags/fedidev',
              name: '#fedidev'
            },
            attachment: [
              {
                type: 'Link',
                href: 'https://patak.cat/'
              }
            ],
            published: new Date(published).toISOString(),
            publicKey: {
              id: `${originalActorId}#main-key`,
              owner: originalActorId,
              publicKeyPem: 'public key'
            },
            endpoints: {
              sharedInbox: 'https://bsky.brid.gy/inbox'
            }
          })
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })
    const announceStatus = response.statuses[0]

    expect(announceStatus.type).toBe(StatusType.enum.Announce)
    if (announceStatus.type !== StatusType.enum.Announce) {
      throw new Error('Expected Announce status')
    }

    expect(announceStatus.originalStatus.actorId).toBe(originalActorId)
    expect(announceStatus.originalStatus.actor).toMatchObject({
      id: originalActorId,
      username: 'patak.cat',
      domain: 'bsky.brid.gy',
      name: 'patak'
    })
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

  it('falls back to Atom feed when outbox has totalItems but no items', async () => {
    const actorId = 'https://pixelfed.example/users/actor'
    const statusId = 'https://pixelfed.example/p/actor/12345'
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <id>${actorId}.atom</id>
      <entry>
        <id>${statusId}</id>
        <title>Pixelfed Post</title>
        <link rel="alternate" href="${statusId}" />
      </entry>
    </feed>`

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://pixelfed.example/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: 'https://pixelfed.example/api/nodeinfo/2.0.json'
              }
            ]
          })
        }
      }

      if (req.url === 'https://pixelfed.example/api/nodeinfo/2.0.json') {
        return {
          status: 200,
          body: JSON.stringify({
            software: { name: 'pixelfed' }
          })
        }
      }

      if (req.url === `${actorId}/outbox`) {
        return {
          status: 200,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 413
          })
        }
      }

      if (req.url === `${actorId}.atom`) {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/atom+xml' },
          body: atomXml
        }
      }

      if (req.url === statusId) {
        return {
          status: 200,
          body: JSON.stringify(
            MockMastodonActivityPubNote({
              id: statusId,
              from: actorId,
              content: 'Atom resolved post',
              withContext: true
            })
          )
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response.statusesCount).toBe(413)
    expect(response.statuses).toHaveLength(1)
    const status = response.statuses[0]
    expect(status.type).toBe(StatusType.enum.Note)
    if (status.type !== StatusType.enum.Note) {
      throw new Error('Expected Note status')
    }
    expect(status.id).toBe(statusId)
    expect(status.text).toContain('Atom resolved post')
  })

  it('does not fall back to Atom feed for non-Pixelfed instances', async () => {
    const actorId = 'https://mastodon.example/users/actor'
    const statusId = 'https://mastodon.example/p/actor/999'
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <id>${actorId}.atom</id>
      <entry>
        <id>${statusId}</id>
        <title>Mastodon Post</title>
      </entry>
    </feed>`

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `https://mastodon.example/.well-known/nodeinfo`) {
        return {
          status: 200,
          body: JSON.stringify({
            links: [
              {
                rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                href: 'https://mastodon.example/nodeinfo/2.0'
              }
            ]
          })
        }
      }

      if (req.url === 'https://mastodon.example/nodeinfo/2.0') {
        return {
          status: 200,
          body: JSON.stringify({
            software: { name: 'mastodon' }
          })
        }
      }

      if (req.url === `${actorId}/outbox`) {
        return {
          status: 200,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 10
          })
        }
      }

      if (req.url === `${actorId}.atom`) {
        return {
          status: 200,
          headers: { 'Content-Type': 'application/atom+xml' },
          body: atomXml
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response.statusesCount).toBe(10)
    expect(response.statuses).toEqual([])
  })

  it('handles outbox with totalItems only when Atom feed is also 404', async () => {
    const actorId = 'https://pixelfed.example/users/noatom'
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${actorId}/outbox`) {
        return {
          status: 200,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 413
          })
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })

    expect(response.statusesCount).toBe(413)
    expect(response.statuses).toEqual([])
    expect(response.nextPageUrl).toBeNull()
    expect(response.prevPageUrl).toBeNull()
  })

  it('returns null statusesCount when remote outbox has no totalItems', async () => {
    const actorId = 'https://blob.cat/users/critical'
    const statusId = `${actorId}/statuses/1`
    const person = MockActivityPubPerson({
      id: actorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${actorId}/outbox`) {
        return {
          status: 200,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${actorId}/outbox`,
            type: 'OrderedCollection',
            first: `${actorId}/outbox?page=true`
          })
        }
      }

      if (req.url === `${actorId}/outbox?page=true`) {
        return {
          status: 200,
          body: JSON.stringify({
            id: `${actorId}/outbox?page=true`,
            type: 'OrderedCollectionPage',
            partOf: `${actorId}/outbox`,
            orderedItems: [
              {
                id: `${statusId}/activity`,
                type: 'Create',
                actor: actorId,
                published: new Date().toISOString(),
                object: MockMastodonActivityPubNote({
                  id: statusId,
                  from: actorId,
                  content: 'Test post content',
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

    expect(response.statusesCount).toBeNull()
    expect(response.statuses).toHaveLength(1)
    expect(response.statuses[0].id).toBe(statusId)
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

  describe('context inheritance (Task B4)', () => {
    it('inherits root-only context definitions into items and embedded objects', async () => {
      const actorId = 'https://root-context.example/users/actor'
      const statusId = `${actorId}/statuses/root-1`
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor

      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        if (req.url === `${actorId}/outbox`) {
          return {
            status: 200,
            body: JSON.stringify({
              '@context': [
                'https://www.w3.org/ns/activitystreams',
                { rootText: 'https://www.w3.org/ns/activitystreams#content' }
              ],
              id: `${actorId}/outbox`,
              type: 'OrderedCollection',
              totalItems: 1,
              orderedItems: [
                {
                  id: `${statusId}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: statusId,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    rootText: 'Hello from root-only context definition',
                    published: new Date().toISOString()
                  }
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
      expect(status.id).toBe(statusId)
      expect(status.text).toBe('Hello from root-only context definition')
      expect(response.statusesCount).toBe(1)
    })

    it('inherits page-only context definitions into items on separately fetched pages', async () => {
      const actorId = 'https://page-context.example/users/actor'
      const statusId = `${actorId}/statuses/page-1`
      const pageUrl = `${actorId}/outbox?page=1`
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor

      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        if (req.url === `${actorId}/outbox`) {
          return {
            status: 200,
            body: JSON.stringify({
              id: `${actorId}/outbox`,
              type: 'OrderedCollection',
              totalItems: 5,
              first: pageUrl
            })
          }
        }
        if (req.url === pageUrl) {
          return {
            status: 200,
            body: JSON.stringify({
              '@context': [
                'https://www.w3.org/ns/activitystreams',
                { pageText: 'https://www.w3.org/ns/activitystreams#content' }
              ],
              id: pageUrl,
              type: 'OrderedCollectionPage',
              partOf: `${actorId}/outbox`,
              next: `${actorId}/outbox?page=2`,
              prev: null,
              orderedItems: [
                {
                  id: `${statusId}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: statusId,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    pageText: 'Hello from page-only context definition',
                    published: new Date().toISOString()
                  }
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
      expect(status.text).toBe('Hello from page-only context definition')
      expect(response.statusesCount).toBe(5)
      expect(response.nextPageUrl).toBe(`${actorId}/outbox?page=2`)
    })

    it('allows item-level context definitions to override inherited definitions', async () => {
      const actorId = 'https://override-context.example/users/actor'
      const statusId = `${actorId}/statuses/override-1`
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor

      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        if (req.url === `${actorId}/outbox`) {
          return {
            status: 200,
            body: JSON.stringify({
              '@context': [
                'https://www.w3.org/ns/activitystreams',
                { customText: 'https://example.com/unrelated#text' }
              ],
              id: `${actorId}/outbox`,
              type: 'OrderedCollection',
              totalItems: 1,
              orderedItems: [
                {
                  '@context': {
                    customText: 'https://www.w3.org/ns/activitystreams#content'
                  },
                  id: `${statusId}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: statusId,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    customText:
                      'Overridden definition successfully parsed as content',
                    published: new Date().toISOString()
                  }
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
      expect(status.text).toBe(
        'Overridden definition successfully parsed as content'
      )
    })

    it('resets context inheritance when an item specifies @context: null', async () => {
      const actorId = 'https://null-reset.example/users/actor'
      const status1Id = `${actorId}/statuses/item-1`
      const status2Id = `${actorId}/statuses/item-2`
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor

      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        if (req.url === `${actorId}/outbox`) {
          return {
            status: 200,
            body: JSON.stringify({
              '@context': [
                'https://www.w3.org/ns/activitystreams',
                { rootText: 'https://www.w3.org/ns/activitystreams#content' }
              ],
              id: `${actorId}/outbox`,
              type: 'OrderedCollection',
              totalItems: 2,
              orderedItems: [
                // Item 1 inherits root context -> rootText becomes content
                {
                  id: `${status1Id}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: status1Id,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    rootText: 'Item 1 inherits root context',
                    published: new Date().toISOString()
                  }
                },
                // Item 2 resets inheritance via null -> rootText is unrecognized and stripped,
                // leaving only standard content
                {
                  '@context': null,
                  id: `${status2Id}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: status2Id,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    rootText: 'Ignored because inheritance was reset',
                    content: 'Item 2 plain content',
                    published: new Date().toISOString()
                  }
                }
              ]
            })
          }
        }
        return { status: 404, body: 'Not Found' }
      })

      const response = await getActorPosts({ database, person })
      expect(response.statuses).toHaveLength(2)
      const [status1, status2] = response.statuses
      expect(status1.type).toBe(StatusType.enum.Note)
      expect(status2.type).toBe(StatusType.enum.Note)
      if (
        status1.type !== StatusType.enum.Note ||
        status2.type !== StatusType.enum.Note
      ) {
        throw new Error('Expected Note statuses')
      }
      expect(status1.text).toBe('Item 1 inherits root context')
      expect(status2.text).toBe('Item 2 plain content')
    })

    it('preserves extension terms like quote and sensitive under inherited context', async () => {
      const actorId = 'https://extension-terms.example/users/actor'
      const statusId = `${actorId}/statuses/extension-1`
      const quotedStatusId = 'https://other.example/statuses/quoted-1'
      const person = MockActivityPubPerson({
        id: actorId,
        withContext: true
      }) as Actor

      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        if (req.url === `${actorId}/outbox`) {
          return {
            status: 200,
            body: JSON.stringify({
              '@context': [
                'https://www.w3.org/ns/activitystreams',
                {
                  toot: 'http://joinmastodon.org/ns#'
                }
              ],
              id: `${actorId}/outbox`,
              type: 'OrderedCollection',
              totalItems: 1,
              orderedItems: [
                {
                  id: `${statusId}/activity`,
                  type: 'Create',
                  actor: actorId,
                  published: new Date().toISOString(),
                  object: {
                    id: statusId,
                    type: 'Note',
                    attributedTo: actorId,
                    to: [ACTIVITY_STREAM_PUBLIC],
                    cc: [],
                    content: 'Post with sensitive and quote',
                    sensitive: true,
                    quoteUrl: quotedStatusId,
                    published: new Date().toISOString()
                  }
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
      expect(status.text).toBe('Post with sensitive and quote')
    })
  })
})
