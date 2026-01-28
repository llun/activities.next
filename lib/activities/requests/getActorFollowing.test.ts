import { enableFetchMocks } from 'jest-fetch-mock'

import { Actor } from '@/lib/types/activitypub'
import { mockRequests } from '@/lib/stub/activities'
import { MockActivityPubFollowing } from '@/lib/stub/following'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'

import { getActorFollowing } from './getActorFollowing'
import { getActorPerson } from './getActorPerson'

enableFetchMocks()

beforeEach(() => {
  fetchMock.resetMocks()
  mockRequests(fetchMock)
})

describe('#getActorFollowing', () => {
  it('returns following actors with total following', async () => {
    const person = (await getActorPerson({
      actorId: ACTOR1_ID
    })) as Actor
    const following = await getActorFollowing({ person })
    expect(following).toMatchObject({
      followingCount: 8,
      following: [ACTOR2_ID, ACTOR3_ID, ACTOR4_ID]
    })
  })

  it('returns following count when collection has no page URL (like Mastodon public endpoints)', async () => {
    const remoteActorId = 'https://remote.test/users/remoteuser'
    fetchMock.resetMocks()
    fetchMock.mockResponse(async (req) => {
      const url = new URL(req.url)
      if (url.pathname === '/users/remoteuser') {
        return {
          status: 200,
          body: JSON.stringify(MockActivityPubPerson({ id: remoteActorId }))
        }
      }
      if (url.pathname === '/users/remoteuser/following') {
        // Simulate Mastodon public endpoint: no 'first' property
        return {
          status: 200,
          body: JSON.stringify(
            MockActivityPubFollowing({
              actorId: remoteActorId,
              totalItems: 649,
              includeFirst: false
            })
          )
        }
      }
      return { status: 404 }
    })

    const person = (await getActorPerson({
      actorId: remoteActorId
    })) as Actor
    const following = await getActorFollowing({ person })
    expect(following).toMatchObject({
      followingCount: 649,
      following: []
    })
  })
})
