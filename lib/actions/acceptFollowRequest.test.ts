import { enableFetchMocks } from 'jest-fetch-mock'

import { AcceptFollow } from '../activities/actions/acceptFollow'
import { FollowStatus } from '../models/follow'
import { SqlStorage } from '../storage/sql'
import { mockRequests } from '../stub/activities'
import { MockFollowRequestResponse } from '../stub/followRequest'
import { ACTOR1_ID } from '../stub/seed/actor1'
import { seedStorage } from '../stub/storage'
import { acceptFollowRequest } from './acceptFollowRequest'

enableFetchMocks()

jest.mock('../config')

describe('Accept follow action', () => {
  const storage = new SqlStorage({
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

      const activity = MockFollowRequestResponse({
        actorId: ACTOR1_ID,
        targetActorId,
        followResponseStatus: 'Accept',
        followId: `https://llun.test/${followRequest?.id}`
      }) as AcceptFollow
      const updatedRequest = await acceptFollowRequest({ activity, storage })
      expect(updatedRequest).toBeTruthy()

      const acceptedRequest = await storage.getFollowFromId({
        followId: followRequest.id
      })
      expect(acceptedRequest?.status).toEqual(FollowStatus.Accepted)
    })

    it('returns null when follow request is not found', async () => {
      const targetActorId =
        'https://somewhere.test/actors/not-request-following'
      const activity = MockFollowRequestResponse({
        actorId: ACTOR1_ID,
        targetActorId,
        followResponseStatus: 'Accept',
        followId: `https://llun.test/random-id`
      }) as AcceptFollow
      const updatedRequest = await acceptFollowRequest({ activity, storage })
      expect(updatedRequest).toBeNull()
    })
  })
})
