import { enableFetchMocks } from 'jest-fetch-mock'

import { ACTIVITY_JSON_HEADERS, mockRequests } from '@/lib/stub/activities'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/activitypub'

import { getActorCollectionCounts } from './getActorCollectionCounts'
import { getActorPerson } from './getActorPerson'

enableFetchMocks()

beforeEach(() => {
  fetchMock.resetMocks()
  mockRequests(fetchMock)
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
})
