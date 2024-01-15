import { enableFetchMocks } from 'jest-fetch-mock'

import { RejectFollow } from '../activities/actions/rejectFollow'
import { FollowStatus } from '../models/follow'
import { SqlStorage } from '../storage/sql'
import { mockRequests } from '../stub/activities'
import { MockFollowRequestResponse } from '../stub/followRequest'
import { ACTOR1_ID } from '../stub/seed/actor1'
import { seedStorage } from '../stub/storage'
import { rejectFollowRequest } from './rejectFollowRequest'

enableFetchMocks()

jest.mock('../config')

describe('Accept follow action', () => {
  const storage = new SqlStorage({
    client: 'better-sqlite3',
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

  describe('#rejectFollow', () => {
    it('update follow status to Rejected and return follow', async () => {
      const targetActorId = 'https://somewhere.test/actors/request-following'
      const followRequest = await storage.getAcceptedOrRequestedFollow({
        actorId: ACTOR1_ID,
        targetActorId
      })
      if (!followRequest) fail('Follow request must exist')

      const activity = MockFollowRequestResponse({
        actorId: ACTOR1_ID,
        targetActorId,
        followResponseStatus: 'Reject',
        followId: `https://llun.test/${followRequest?.id}`
      }) as RejectFollow
      const updatedRequest = await rejectFollowRequest({ activity, storage })
      expect(updatedRequest).toBeTruthy()

      const acceptedRequest = await storage.getFollowFromId({
        followId: followRequest.id
      })
      expect(acceptedRequest?.status).toEqual(FollowStatus.enum.Rejected)
    })

    it('returns null when follow request is not found', async () => {
      const targetActorId =
        'https://somewhere.test/actors/not-request-following'
      const activity = MockFollowRequestResponse({
        actorId: ACTOR1_ID,
        targetActorId,
        followResponseStatus: 'Reject',
        followId: `https://llun.test/random-id`
      }) as RejectFollow
      const updatedRequest = await rejectFollowRequest({ activity, storage })
      expect(updatedRequest).toBeNull()
    })
  })
})
