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

  it('keeps followers and following null when Misskey actor sets them to private', async () => {
    const misskeyActorId = 'https://misskey.test/users/7rkrarq81i'
    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      const url = new URL(req.url)
      if (url.pathname === '/users/7rkrarq81i') {
        return {
          status: 200,
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
          body: JSON.stringify({
            id: '7rkrarq81i',
            followersCount: 0,
            followingCount: 0,
            notesCount: 500,
            followersVisibility: 'private',
            followingVisibility: 'private'
          })
        }
      }
      if (url.pathname === '/users/7rkrarq81i/outbox') {
        return {
          status: 200,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: req.url,
            type: 'OrderedCollection',
            totalItems: 500
          })
        }
      }
      if (
        url.pathname === '/users/7rkrarq81i/followers' ||
        url.pathname === '/users/7rkrarq81i/following'
      ) {
        return { status: 403, body: '' }
      }
      return { status: 404, body: 'Not Found' }
    })

    const person = (await getActorPerson({ actorId: misskeyActorId })) as Actor

    await expect(getActorCollectionCounts({ person })).resolves.toEqual({
      followersCount: null,
      followingCount: null,
      statusesCount: 500
    })
  })

  it('populates public followersCount for Misskey actor when public in users/show', async () => {
    const misskeyActorId = 'https://misskey.test/users/publicuser'
    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      const url = new URL(req.url)
      if (url.pathname === '/users/publicuser') {
        return {
          status: 200,
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
          body: JSON.stringify({
            id: 'publicuser',
            followersCount: 888,
            followingCount: 0,
            notesCount: 100,
            followersVisibility: 'public',
            followingVisibility: 'private'
          })
        }
      }
      if (url.pathname === '/users/publicuser/outbox') {
        return {
          status: 200,
          body: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: req.url,
            type: 'OrderedCollection',
            totalItems: 100
          })
        }
      }
      if (
        url.pathname === '/users/publicuser/followers' ||
        url.pathname === '/users/publicuser/following'
      ) {
        return { status: 404, body: '' }
      }
      return { status: 404, body: 'Not Found' }
    })

    const person = (await getActorPerson({ actorId: misskeyActorId })) as Actor

    await expect(getActorCollectionCounts({ person })).resolves.toEqual({
      followersCount: 888,
      followingCount: null,
      statusesCount: 100
    })
  })
})
