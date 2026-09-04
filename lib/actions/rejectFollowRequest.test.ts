import { enableFetchMocks } from 'jest-fetch-mock'

import { rejectFollowRequest } from '@/lib/actions/rejectFollowRequest'
import { RejectFollow } from '@/lib/activities/rejectFollow'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockFollowRequestResponse } from '@/lib/stub/followRequest'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { FollowStatus } from '@/lib/types/domain/follow'

enableFetchMocks()

describe('Reject follow action', () => {
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

  describe('rejectFollowRequest', () => {
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

    it('handles Reject activity where object is a string URI (Lemmy / PeerTube format)', async () => {
      const targetActorId = 'https://somewhere.test/actors/request-following-2'
      const follow = await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        status: FollowStatus.enum.Requested,
        inbox: 'https://somewhere.test/inbox',
        sharedInbox: 'https://somewhere.test/inbox'
      })

      const activity: RejectFollow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/activities/reject-1',
        type: 'Reject',
        actor: targetActorId,
        object: `https://llun.test/${follow.id}`
      }
      const updated = await rejectFollowRequest({ activity, database })
      expect(updated).toBeTruthy()
      expect(updated?.id).toEqual(follow.id)
      expect(updated?.status).toEqual(FollowStatus.enum.Rejected)
    })

    it('resolves follow via recipientActorId fallback when object is an arbitrary URI', async () => {
      const targetActorId = 'https://somewhere.test/actors/request-following-3'
      const follow = await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        status: FollowStatus.enum.Requested,
        inbox: 'https://somewhere.test/inbox',
        sharedInbox: 'https://somewhere.test/inbox'
      })

      const activity: RejectFollow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/activities/reject-2',
        type: 'Reject',
        actor: targetActorId,
        object: 'https://somewhere.test/arbitrary-follow-id'
      }
      const updated = await rejectFollowRequest({
        activity,
        database,
        recipientActorId: ACTOR1_ID
      })
      expect(updated).toBeTruthy()
      expect(updated?.id).toEqual(follow.id)
      expect(updated?.status).toEqual(FollowStatus.enum.Rejected)
    })

    it('returns follow immediately if already Rejected (idempotent)', async () => {
      const targetActorId = 'https://somewhere.test/actors/request-following-4'
      const follow = await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        status: FollowStatus.enum.Rejected,
        inbox: 'https://somewhere.test/inbox',
        sharedInbox: 'https://somewhere.test/inbox'
      })

      const activity: RejectFollow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/activities/reject-3',
        type: 'Reject',
        actor: targetActorId,
        object: `https://llun.test/${follow.id}`
      }
      const updated = await rejectFollowRequest({ activity, database })
      expect(updated).toBeTruthy()
      expect(updated?.status).toEqual(FollowStatus.enum.Rejected)
    })
  })
})
