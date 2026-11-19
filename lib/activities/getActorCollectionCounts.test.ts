/** @vitest-size medium */
import { enableFetchMocks } from 'jest-fetch-mock'

import { isFederatedRedirect } from '@/lib/services/federation/federatedRedirect'
import { ACTIVITY_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/activitypub'

import { getActorCollectionCounts } from './getActorCollectionCounts'
import { getActorPerson } from './getActorPerson'

enableFetchMocks()

vi.mock('@/lib/services/federation/federatedRedirect', () => ({
  isFederatedRedirect: vi.fn()
}))

beforeEach(() => {
  fetchMock.resetMocks()
  mockRequests(fetchMock)
  vi.mocked(isFederatedRedirect).mockReset().mockResolvedValue(true)
})

describe('getActorCollectionCounts', () => {
  it('returns the totalItems advertised by each collection', async () => {
    const person = (await getActorPerson({ actorId: ACTOR1_ID })) as Actor

    await expect(getActorCollectionCounts({ person })).resolves.toEqual({
      followersCount: 8,
      followingCount: 8,
      statusesCount: 10
    })
  })

  it('returns null for collections that fail to load', async () => {
    const remoteActorId = 'https://remote.test/users/unavailable'
    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      const url = new URL(req.url)
      if (url.pathname === '/users/unavailable') {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify(MockActivityPubPerson({ id: remoteActorId }))
        }
      }
      if (url.pathname === '/users/unavailable/outbox') {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${remoteActorId}/outbox`,
            type: 'OrderedCollection',
            totalItems: 42
          })
        }
      }
      return { status: 404 }
    })

    const person = (await getActorPerson({ actorId: remoteActorId })) as Actor

    await expect(getActorCollectionCounts({ person })).resolves.toEqual({
      followersCount: null,
      followingCount: null,
      statusesCount: 42
    })
  })

  it('returns null when a collection has no numeric totalItems', async () => {
    const remoteActorId = 'https://remote.test/users/hidden'
    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      const url = new URL(req.url)
      if (url.pathname === '/users/hidden') {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify(MockActivityPubPerson({ id: remoteActorId }))
        }
      }
      return {
        status: 200,
        headers: ACTIVITY_JSON_HEADERS,
        body: JSON.stringify({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: req.url,
          type: 'OrderedCollection'
        })
      }
    })

    const person = (await getActorPerson({ actorId: remoteActorId })) as Actor

    await expect(getActorCollectionCounts({ person })).resolves.toEqual({
      followersCount: null,
      followingCount: null,
      statusesCount: null
    })
  })

  it.each([
    {
      description: 'keeps followers and following null when set to private',
      username: '7rkrarq81i',
      users: {
        followersCount: 0,
        followingCount: 0,
        notesCount: 500,
        followersVisibility: 'private',
        followingVisibility: 'private'
      },
      collectionStatus: 403,
      expected: {
        followersCount: null,
        followingCount: null,
        statusesCount: 500
      }
    },
    {
      description: 'populates public followersCount from users/show',
      username: 'publicuser',
      users: {
        followersCount: 888,
        followingCount: 0,
        notesCount: 100,
        followersVisibility: 'public',
        followingVisibility: 'private'
      },
      collectionStatus: 404,
      expected: {
        followersCount: 888,
        followingCount: null,
        statusesCount: 100
      }
    }
  ])(
    'for a Misskey actor, $description',
    async ({ username, users, collectionStatus, expected }) => {
      const misskeyActorId = `https://misskey.test/users/${username}`
      fetchMock.resetMocks()
      fetchMock.mockResponse(async (req) => {
        const url = new URL(req.url)
        if (url.pathname === `/users/${username}`) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify(MockActivityPubPerson({ id: misskeyActorId }))
          }
        }
        if (url.pathname === '/.well-known/nodeinfo') {
          return {
            status: 200,
            body: JSON.stringify({
              links: [
                {
                  rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
                  href: 'https://misskey.test/nodeinfo/2.0'
                }
              ]
            })
          }
        }
        if (url.pathname === '/nodeinfo/2.0') {
          return {
            status: 200,
            body: JSON.stringify({
              software: { name: 'misskey', version: '2025.4.1' }
            })
          }
        }
        if (url.pathname === '/api/users/show') {
          return {
            status: 200,
            body: JSON.stringify({ id: username, ...users })
          }
        }
        if (url.pathname === `/users/${username}/outbox`) {
          return {
            status: 200,
            headers: ACTIVITY_JSON_HEADERS,
            body: JSON.stringify({
              '@context': 'https://www.w3.org/ns/activitystreams',
              id: req.url,
              type: 'OrderedCollection',
              totalItems: users.notesCount
            })
          }
        }
        if (
          url.pathname === `/users/${username}/followers` ||
          url.pathname === `/users/${username}/following`
        ) {
          return { status: collectionStatus, body: '' }
        }
        return { status: 404, body: 'Not Found' }
      })

      const person = (await getActorPerson({
        actorId: misskeyActorId
      })) as Actor

      await expect(getActorCollectionCounts({ person })).resolves.toEqual(
        expected
      )
    }
  )

  it('does not fetch a collection on a domain federation policy refuses', async () => {
    const person = {
      id: 'https://remote.test/users/alice',
      followers: 'https://blocked-collection.test/users/alice/followers',
      following: 'https://blocked-collection.test/users/alice/following',
      outbox: 'https://remote.test/users/alice/outbox'
    } as Actor

    vi.mocked(isFederatedRedirect).mockResolvedValue(false)
    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      if (req.url === person.outbox) {
        return {
          status: 200,
          headers: ACTIVITY_JSON_HEADERS,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: person.outbox,
            type: 'OrderedCollection',
            totalItems: 42
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    await expect(getActorCollectionCounts({ person })).resolves.toEqual({
      followersCount: null,
      followingCount: null,
      statusesCount: 42
    })
    const requested = fetchMock.mock.calls.map(([input]) => String(input))
    expect(requested).not.toContain(person.followers)
    expect(requested).not.toContain(person.following)
  })

  it('fetches a collection on an allowed cross-host domain', async () => {
    const person = {
      id: 'https://remote.test/users/alice',
      followers: 'https://allowed-collection.test/users/alice/followers',
      following: 'https://remote.test/users/alice/following',
      outbox: 'https://remote.test/users/alice/outbox'
    } as Actor

    vi.mocked(isFederatedRedirect).mockResolvedValue(true)
    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => ({
      status: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: req.url,
        type: 'OrderedCollection',
        totalItems: req.url === person.followers ? 9 : 1
      })
    }))

    await expect(getActorCollectionCounts({ person })).resolves.toEqual({
      followersCount: 9,
      followingCount: 1,
      statusesCount: 1
    })
    expect(vi.mocked(isFederatedRedirect).mock.calls[0][0].href).toBe(
      person.followers
    )
  })

  it('does not consult federation policy for same-origin collections', async () => {
    const person = {
      id: 'https://remote.test/users/alice',
      followers: 'https://remote.test/users/alice/followers',
      following: 'https://remote.test/users/alice/following',
      outbox: 'https://remote.test/users/alice/outbox'
    } as Actor

    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => ({
      status: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: req.url,
        type: 'OrderedCollection',
        totalItems: 1
      })
    }))

    await expect(getActorCollectionCounts({ person })).resolves.toEqual({
      followersCount: 1,
      followingCount: 1,
      statusesCount: 1
    })
    expect(isFederatedRedirect).not.toHaveBeenCalled()
  })
})
