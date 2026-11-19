import { enableFetchMocks } from 'jest-fetch-mock'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { isFederatedRedirect } from '@/lib/services/federation/federatedRedirect'
import { clearServerSoftwareCache } from '@/lib/services/federation/serverSoftware'
import { ACTIVITY_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { Actor } from '@/lib/types/activitypub'
import { AnnounceAction } from '@/lib/types/activitypub/activities'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { getActorPosts } from './getActorPosts'

enableFetchMocks()

vi.mock('@/lib/services/federation/federatedRedirect', () => ({
  isFederatedRedirect: vi.fn()
}))

describe('getActorPosts', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
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
    vi.mocked(isFederatedRedirect).mockReset().mockResolvedValue(true)
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
          headers: ACTIVITY_JSON_HEADERS,
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
          headers: ACTIVITY_JSON_HEADERS,
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
          headers: ACTIVITY_JSON_HEADERS,
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

  it('drops an Announce whose fetched original is followers-only', async () => {
    // The original is not stored, so it is fetched signed by the instance
    // actor, and a server that filters by signer serves a followers-only note
    // to a follower. It must not reach a local viewer as a boost.
    const boosterActorId = 'https://boost-private.example/users/booster'
    const originalStatusId = `${boosterActorId}/statuses/private-original`
    const published = Date.now()
    const person = MockActivityPubPerson({
      id: boosterActorId,
      withContext: true
    }) as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === `${boosterActorId}/outbox`) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
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
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            id: `${boosterActorId}/outbox?page=true`,
            type: 'OrderedCollectionPage',
            partOf: `${boosterActorId}/outbox`,
            orderedItems: [
              {
                id: `${boosterActorId}/statuses/private-boost/activity`,
                type: AnnounceAction,
                actor: boosterActorId,
                published: new Date(published).toISOString(),
                to: [`${boosterActorId}/followers`],
                cc: [],
                object: originalStatusId
              }
            ]
          })
        }
      }

      if (req.url === originalStatusId) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify(
            MockMastodonActivityPubNote({
              id: originalStatusId,
              from: boosterActorId,
              content: 'Followers only',
              to: [`${boosterActorId}/followers`],
              cc: [],
              withContext: true
            })
          )
        }
      }

      return { status: 404, body: 'Not Found' }
    })

    const response = await getActorPosts({ database, person })
    expect(response.statuses).toEqual([])
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
          headers: ACTIVITY_JSON_HEADERS,
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
          headers: ACTIVITY_JSON_HEADERS,
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
          headers: ACTIVITY_JSON_HEADERS,
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
          headers: ACTIVITY_JSON_HEADERS,
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
          headers: ACTIVITY_JSON_HEADERS,
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
          headers: ACTIVITY_JSON_HEADERS,
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
          headers: ACTIVITY_JSON_HEADERS,
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
          headers: ACTIVITY_JSON_HEADERS,
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

  const mockOutboxWithAnnounce = ({
    actorId,
    announceStatusId,
    objectId,
    objectActorId,
    published
  }: {
    actorId: string
    announceStatusId: string
    objectId: string
    objectActorId: string
    published: number
  }) => {
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
                id: announceStatusId,
                type: AnnounceAction,
                actor: actorId,
                published: new Date(published).toISOString(),
                to: [ACTIVITY_STREAM_PUBLIC],
                cc: [`${actorId}/followers`],
                object: objectId
              }
            ]
          })
        }
      }

      if (req.url === objectId) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify(
            MockMastodonActivityPubNote({
              id: objectId,
              from: objectActorId,
              content: 'Original status text',
              withContext: true
            })
          )
        }
      }

      return { status: 404, body: 'Not Found' }
    })
  }

  it('does not fetch an announced object on a domain federation policy refuses', async () => {
    const boosterActorId = 'https://boost-blocked.example/users/booster'
    const originalActorId = 'https://blocked-origin.example/users/original'
    const originalStatusId = `${originalActorId}/statuses/blocked`
    const announceStatusId = `${boosterActorId}/statuses/announce-blocked/activity`
    const person = MockActivityPubPerson({
      id: boosterActorId,
      withContext: true
    }) as Actor

    vi.mocked(isFederatedRedirect).mockResolvedValue(false)
    mockOutboxWithAnnounce({
      actorId: boosterActorId,
      announceStatusId,
      objectId: originalStatusId,
      objectActorId: originalActorId,
      published: Date.now()
    })

    const response = await getActorPosts({ database, person })

    expect(response.statuses).toEqual([])
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(
      originalStatusId
    )
  })

  it('fetches an announced object on an allowed cross-host domain', async () => {
    const boosterActorId = 'https://boost-allowed.example/users/booster'
    const originalActorId = 'https://allowed-origin.example/users/original'
    const originalStatusId = `${originalActorId}/statuses/allowed`
    const announceStatusId = `${boosterActorId}/statuses/announce-allowed/activity`
    const person = MockActivityPubPerson({
      id: boosterActorId,
      withContext: true
    }) as Actor

    vi.mocked(isFederatedRedirect).mockResolvedValue(true)
    mockOutboxWithAnnounce({
      actorId: boosterActorId,
      announceStatusId,
      objectId: originalStatusId,
      objectActorId: originalActorId,
      published: Date.now()
    })

    const response = await getActorPosts({ database, person })

    expect(response.statuses).toHaveLength(1)
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      originalStatusId
    )
  })

  it('does not consult federation policy for an announced object on the actor origin', async () => {
    const boosterActorId = 'https://boost-same-origin.example/users/booster'
    const originalStatusId = `${boosterActorId}/statuses/same-origin`
    const announceStatusId = `${boosterActorId}/statuses/announce-same-origin/activity`
    const person = MockActivityPubPerson({
      id: boosterActorId,
      withContext: true
    }) as Actor

    // A refusal would drop the item, so a kept item proves the lookup was
    // skipped rather than answered.
    vi.mocked(isFederatedRedirect).mockResolvedValue(false)
    mockOutboxWithAnnounce({
      actorId: boosterActorId,
      announceStatusId,
      objectId: originalStatusId,
      objectActorId: boosterActorId,
      published: Date.now()
    })

    const response = await getActorPosts({ database, person })

    expect(response.statuses).toHaveLength(1)
    expect(isFederatedRedirect).not.toHaveBeenCalled()
  })
})
