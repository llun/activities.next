import { enableFetchMocks } from 'jest-fetch-mock'

import { Actor } from '../models/actor'
import { FollowStatus } from '../models/follow'
import { Sqlite3Storage } from '../storage/sqlite3'
import { mockRequests } from '../stub/activities'
import { MockAcceptFollowRequest } from '../stub/followRequest'
import { ACTOR1_ID, seedActor1 } from '../stub/seed/actor1'
import { seedStorage } from '../stub/storage'
import { acceptFollowRequest } from './acceptFollowRequest'

enableFetchMocks()

jest.mock('../config')

describe('Accept follow action', () => {
  const storage = new Sqlite3Storage({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('#acceptFollow', () => {
    it('update follow status to Accepted and return follow', async () => {
      const targetActorId = 'https://somewhere.test/actors/request-following'
      const followRequest = await storage.getAcceptedOrRequestedFollow({
        actorId: ACTOR1_ID,
        targetActorId
      })
      if (!followRequest) fail('Follow request must exist')

      const activity = MockAcceptFollowRequest({
        actorId: ACTOR1_ID,
        targetActorId,
        followId: `${ACTOR1_ID}/${followRequest?.id}`
      })
      const updatedRequest = await acceptFollowRequest({ activity, storage })
      expect(updatedRequest).toBeTruthy()

      const acceptedRequest = await storage.getFollowFromId({
        followId: followRequest.id
      })
      expect(acceptedRequest?.status).toEqual(FollowStatus.Accepted)
    })
  })
})
