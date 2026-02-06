import { enableFetchMocks } from 'jest-fetch-mock'

import { mockRequests } from '@/lib/stub/activities'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { getActorPerson } from './getActorPerson'

enableFetchMocks()

describe('#getActorPerson', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('returns person from user id', async () => {
    const person = await getActorPerson({
      actorId: ACTOR1_ID
    })
    const expected = MockActivityPubPerson({
      id: ACTOR1_ID,
      withContext: false
    })
    expect(person).toMatchObject({
      ...expected,
      published: expect.any(String)
    })
  })

  it('returns null for not found actor', async () => {
    const person = await getActorPerson({
      actorId: 'notexist'
    })
    expect(person).toBeNull()
  })
})
