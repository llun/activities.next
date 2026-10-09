import { enableFetchMocks } from 'jest-fetch-mock'

import { MockActivityPubPerson } from '@/lib/stub/person'
import { Actor } from '@/lib/types/activitypub'

import { getMisskeyCollectionCounts } from './getMisskeyCollectionCounts'

enableFetchMocks()

describe('getMisskeyCollectionCounts', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it.each([
    {
      description: 'both are private',
      api: {
        followersCount: 0,
        followingCount: 0,
        notesCount: 1500,
        followersVisibility: 'private',
        followingVisibility: 'private'
      },
      currentStatusesCount: 1500,
      expected: {
        followersCount: null,
        followingCount: null,
        statusesCount: 1500
      }
    },
    {
      description: 'only followers is public',
      api: {
        followersCount: 250,
        followingCount: 0,
        notesCount: 50,
        followersVisibility: 'public',
        followingVisibility: 'private'
      },
      currentStatusesCount: 50,
      expected: { followersCount: 250, followingCount: null, statusesCount: 50 }
    },
    {
      description: 'only following is public',
      api: {
        followersCount: 0,
        followingCount: 120,
        notesCount: 80,
        followersVisibility: 'private',
        followingVisibility: 'public'
      },
      currentStatusesCount: 80,
      expected: { followersCount: null, followingCount: 120, statusesCount: 80 }
    },
    {
      description: 'both are public',
      api: {
        followersCount: 1000,
        followingCount: 200,
        notesCount: 500,
        followersVisibility: 'public',
        followingVisibility: 'public'
      },
      currentStatusesCount: null,
      expected: {
        followersCount: 1000,
        followingCount: 200,
        statusesCount: 500
      }
    }
  ])(
    'only exposes the counts whose visibility is public when $description',
    async ({ api, currentStatusesCount, expected }) => {
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
              ...api
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
          statusesCount: currentStatusesCount
        }
      })

      expect(result).toEqual(expected)
    }
  )

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
