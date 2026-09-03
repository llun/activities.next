import { enableFetchMocks } from 'jest-fetch-mock'

import { MockActivityPubPerson } from '@/lib/stub/person'
import { Actor } from '@/lib/types/activitypub'

import { getMisskeyCollectionCounts } from './getMisskeyCollectionCounts'

enableFetchMocks()

describe('getMisskeyCollectionCounts', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('keeps followersCount and followingCount null when visibility is private', async () => {
    const person = MockActivityPubPerson({
      id: 'https://misskey.example/users/7rkrarq81i'
    }) as Actor

    fetchMock.mockResponse(async (req) => {
      if (req.url === 'https://misskey.example/api/users/show') {
        return {
          status: 200,
          body: JSON.stringify({
            id: '7rkrarq81i',
            username: person.preferredUsername,
            followersCount: 0,
            followingCount: 0,
            notesCount: 1500,
            followersVisibility: 'private',
            followingVisibility: 'private'
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const result = await getMisskeyCollectionCounts({
      person,
      currentCounts: {
        followersCount: null,
        followingCount: null,
        statusesCount: 1500
      }
    })

    expect(result).toEqual({
      followersCount: null,
      followingCount: null,
      statusesCount: 1500
    })
  })

  it('populates public followersCount while keeping followingCount null when following is private', async () => {
    const person = MockActivityPubPerson({
      id: 'https://misskey.example/users/7rkrarq81i'
    }) as Actor

    fetchMock.mockResponse(async (req) => {
      if (req.url === 'https://misskey.example/api/users/show') {
        return {
          status: 200,
          body: JSON.stringify({
            id: '7rkrarq81i',
            username: person.preferredUsername,
            followersCount: 250,
            followingCount: 0,
            notesCount: 50,
            followersVisibility: 'public',
            followingVisibility: 'private'
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const result = await getMisskeyCollectionCounts({
      person,
      currentCounts: {
        followersCount: null,
        followingCount: null,
        statusesCount: 50
      }
    })

    expect(result).toEqual({
      followersCount: 250,
      followingCount: null,
      statusesCount: 50
    })
  })

  it('populates public followingCount while keeping followersCount null when followers is private', async () => {
    const person = MockActivityPubPerson({
      id: 'https://misskey.example/users/7rkrarq81i'
    }) as Actor

    fetchMock.mockResponse(async (req) => {
      if (req.url === 'https://misskey.example/api/users/show') {
        return {
          status: 200,
          body: JSON.stringify({
            id: '7rkrarq81i',
            username: person.preferredUsername,
            followersCount: 0,
            followingCount: 120,
            notesCount: 80,
            followersVisibility: 'private',
            followingVisibility: 'public'
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const result = await getMisskeyCollectionCounts({
      person,
      currentCounts: {
        followersCount: null,
        followingCount: null,
        statusesCount: 80
      }
    })

    expect(result).toEqual({
      followersCount: null,
      followingCount: 120,
      statusesCount: 80
    })
  })

  it('populates both followers and following counts when both are public', async () => {
    const person = MockActivityPubPerson({
      id: 'https://misskey.example/users/7rkrarq81i'
    }) as Actor

    fetchMock.mockResponse(async (req) => {
      if (req.url === 'https://misskey.example/api/users/show') {
        return {
          status: 200,
          body: JSON.stringify({
            id: '7rkrarq81i',
            username: person.preferredUsername,
            followersCount: 1000,
            followingCount: 200,
            notesCount: 500,
            followersVisibility: 'public',
            followingVisibility: 'public'
          })
        }
      }
      return { status: 404, body: 'Not Found' }
    })

    const result = await getMisskeyCollectionCounts({
      person,
      currentCounts: {
        followersCount: null,
        followingCount: null,
        statusesCount: null
      }
    })

    expect(result).toEqual({
      followersCount: 1000,
      followingCount: 200,
      statusesCount: 500
    })
  })

  it('returns current counts when request fails', async () => {
    const person = MockActivityPubPerson({
      id: 'https://misskey.example/users/7rkrarq81i'
    }) as Actor

    fetchMock.mockResponse(async () => {
      return { status: 500, body: 'Server Error' }
    })

    const result = await getMisskeyCollectionCounts({
      person,
      currentCounts: {
        followersCount: null,
        followingCount: 42,
        statusesCount: 10
      }
    })

    expect(result).toEqual({
      followersCount: null,
      followingCount: 42,
      statusesCount: 10
    })
  })
})
