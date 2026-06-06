import { enableFetchMocks } from 'jest-fetch-mock'

import { mockRequests } from '@/lib/stub/activities'
import { MockActor } from '@/lib/stub/actor'
import { MockActivityPubPerson } from '@/lib/stub/person'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { getActorPerson } from './getActorPerson'

enableFetchMocks()

describe('getActorPerson', () => {
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

  it('signs GET requests when a signing actor is provided', async () => {
    const remoteActorId = 'https://remote.test/users/signed'
    const person = await getActorPerson({
      actorId: remoteActorId,
      signingActor: MockActor({ id: 'https://llun.test/users/local' })
    })

    expect(person).not.toBeNull()

    const call = fetchMock.mock.calls.find(([url]) => url === remoteActorId)
    expect(call).toBeDefined()
    const request = call?.[1]
    expect(request?.headers).toMatchObject({
      host: 'remote.test',
      signature: expect.stringContaining('headers="(request-target) host date"')
    })
  })
})
