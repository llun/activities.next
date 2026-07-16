import { enableFetchMocks } from 'jest-fetch-mock'

import { mockRequests } from '@/lib/stub/activities'
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
          body: JSON.stringify(MockActivityPubPerson({ id: remoteActorId }))
        }
      }
      if (url.pathname === '/users/unavailable/outbox') {
        return {
          status: 200,
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
          body: JSON.stringify(MockActivityPubPerson({ id: remoteActorId }))
        }
      }
      return {
        status: 200,
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
})
