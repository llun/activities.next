import { enableFetchMocks } from 'jest-fetch-mock'

import { rejectFollowRequest } from '@/lib/actions/rejectFollowRequest'
import { RejectFollow } from '@/lib/activities/actions/rejectFollow'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { FollowStatus } from '@/lib/models/follow'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockFollowRequestResponse } from '@/lib/stub/followRequest'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

enableFetchMocks()

describe('Accept follow action', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('#rejectFollow', () => {
    it('update follow status to Rejected and return follow', async () => {
      const targetActorId = 'https://somewhere.test/actors/request-following'
      const followRequest = await database.getAcceptedOrRequestedFollow({
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
      const updatedRequest = await rejectFollowRequest({ activity, database })
      expect(updatedRequest).toBeTruthy()

      const acceptedRequest = await database.getFollowFromId({
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
      const updatedRequest = await rejectFollowRequest({ activity, database })
      expect(updatedRequest).toBeNull()
    })
  })
})
