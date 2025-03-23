import { Actor } from '@llun/activities.schema'
import { enableFetchMocks } from 'jest-fetch-mock'

import { mockRequests } from '@/lib/stub/activities'
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
})
