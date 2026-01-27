import { Actor } from '@/lib/schema'
import { enableFetchMocks } from 'jest-fetch-mock'

import { mockRequests } from '@/lib/stub/activities'
import { MockActivityPubFollowers } from '@/lib/stub/followers'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'

import { getActorFollowers } from './getActorFollowers'
import { getActorPerson } from './getActorPerson'

enableFetchMocks()

beforeEach(() => {
  fetchMock.resetMocks()
  mockRequests(fetchMock)
})

describe('#getActorFollowers', () => {
  it('returns followers actors with total followers', async () => {
    const person = (await getActorPerson({
      actorId: ACTOR1_ID
    })) as Actor
    const followers = await getActorFollowers({ person })
    expect(followers).toMatchObject({
      followerCount: 8,
      followers: [ACTOR2_ID, ACTOR3_ID, ACTOR4_ID]
    })
  })

  it('returns follower count when collection has no page URL (like Mastodon public endpoints)', async () => {
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
      if (url.pathname === '/users/remoteuser/followers') {
        // Simulate Mastodon public endpoint: no 'first' property
        return {
          status: 200,
          body: JSON.stringify(
            MockActivityPubFollowers({
              actorId: remoteActorId,
              totalItems: 565,
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
    const followers = await getActorFollowers({ person })
    expect(followers).toMatchObject({
      followerCount: 565,
      followers: []
    })
  })
})
