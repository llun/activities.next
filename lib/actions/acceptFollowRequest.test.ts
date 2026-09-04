import { enableFetchMocks } from 'jest-fetch-mock'

import { acceptFollowRequest } from '@/lib/actions/acceptFollowRequest'
import { AcceptFollow } from '@/lib/activities/acceptFollow'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { FOLLOW_TIMELINE_BACKFILL_JOB_NAME } from '@/lib/jobs/names'
import { buildFollowEmail } from '@/lib/services/email/templates/follow'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockFollowRequestResponse } from '@/lib/stub/followRequest'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR5_ID } from '@/lib/stub/seed/actor5'
import { NotificationType } from '@/lib/types/database/operations'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getHashFromString } from '@/lib/utils/getHashFromString'

enableFetchMocks()

vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

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
    vi.clearAllMocks()
    vi.mocked(getQueue().publish).mockReset().mockResolvedValue(undefined)
  })

  describe('acceptFollowRequest', () => {
    it('update follow status to Accepted and return follow', async () => {
      const targetActorId = 'https://somewhere.test/actors/request-following'
      const followRequest = await database.getAcceptedOrRequestedFollow({
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
      const updatedRequest = await acceptFollowRequest({
        activity,
        database
      })
      expect(updatedRequest).toBeTruthy()

      const acceptedRequest = await database.getFollowFromId({
        followId: followRequest.id
      })
      expect(acceptedRequest?.status).toEqual(FollowStatus.enum.Accepted)
    })

    it('calls sendNotificationAlerts with email content when target actor is local account', async () => {
      const followRequest = await database.getAcceptedOrRequestedFollow({
        actorId: ACTOR5_ID,
        targetActorId: ACTOR1_ID
      })
      if (!followRequest) fail('Follow request must exist')

      const activity = MockFollowRequestResponse({
        actorId: ACTOR5_ID,
        targetActorId: ACTOR1_ID,
        followResponseStatus: 'Accept',
        followId: `https://llun.test/${followRequest?.id}`
      }) as AcceptFollow
      const updatedRequest = await acceptFollowRequest({
        activity,
        database
      })
      expect(updatedRequest).toBeTruthy()

      const acceptedRequest = await database.getFollowFromId({
        followId: followRequest.id
      })
      const actor5 = await database.getActorFromId({ id: ACTOR5_ID })
      const actor1 = await database.getActorFromId({ id: ACTOR1_ID })
      if (!actor5) fail('Actor5 should be exists')
      if (!actor1) fail('Actor1 should be exists')
      expect(acceptedRequest?.status).toEqual(FollowStatus.enum.Accepted)

      expect(sendNotificationAlerts).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ACTOR1_ID,
          sourceActorId: ACTOR5_ID,
          events: [
            {
              type: NotificationType.enum.follow,
              emailContent: expect.objectContaining({
                recipientEmail: 'test1@llun.test',
                // The recipient is threaded through so the footer can name the
                // account whose notification settings control this email.
                ...buildFollowEmail({ recipient: actor1, actor: actor5 })
              })
            }
          ]
        })
      )
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
      const updatedRequest = await acceptFollowRequest({
        activity,
        database
      })
      expect(updatedRequest).toBeNull()
    })

    it('queues follow timeline backfill job on remote target accept', async () => {
      const targetActorId = 'https://somewhere.test/actors/request-following'
      const followRequest = await database.getAcceptedOrRequestedFollow({
        actorId: ACTOR1_ID,
        targetActorId
      })
      if (!followRequest) fail('Follow request must exist')

      const activity = MockFollowRequestResponse({
        actorId: ACTOR1_ID,
        targetActorId,
        followResponseStatus: 'Accept',
        followId: `https://llun.test/${followRequest.id}`
      }) as AcceptFollow
      await acceptFollowRequest({
        activity,
        database
      })

      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(`${followRequest.id}#backfill`),
        name: FOLLOW_TIMELINE_BACKFILL_JOB_NAME,
        data: { actorId: ACTOR1_ID, targetActorId }
      })
    })

    it('queues follow timeline backfill job on local target accept', async () => {
      const followRequest = await database.getAcceptedOrRequestedFollow({
        actorId: ACTOR5_ID,
        targetActorId: ACTOR1_ID
      })
      if (!followRequest) fail('Follow request must exist')

      const activity = MockFollowRequestResponse({
        actorId: ACTOR5_ID,
        targetActorId: ACTOR1_ID,
        followResponseStatus: 'Accept',
        followId: `https://llun.test/${followRequest.id}`
      }) as AcceptFollow
      await acceptFollowRequest({
        activity,
        database
      })

      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(`${followRequest.id}#backfill`),
        name: FOLLOW_TIMELINE_BACKFILL_JOB_NAME,
        data: { actorId: ACTOR5_ID, targetActorId: ACTOR1_ID }
      })
    })

    it('handles queue publish failure gracefully', async () => {
      vi.mocked(getQueue().publish).mockRejectedValueOnce(
        new Error('queue down')
      )
      const targetActorId = 'https://somewhere.test/actors/request-following'
      const followRequest = await database.getAcceptedOrRequestedFollow({
        actorId: ACTOR1_ID,
        targetActorId
      })
      if (!followRequest) fail('Follow request must exist')

      const activity = MockFollowRequestResponse({
        actorId: ACTOR1_ID,
        targetActorId,
        followResponseStatus: 'Accept',
        followId: `https://llun.test/${followRequest.id}`
      }) as AcceptFollow
      const updatedRequest = await acceptFollowRequest({
        activity,
        database
      })

      expect(updatedRequest).toBeTruthy()
    })

    it('handles Accept activity where object is a string URI (Lemmy / PeerTube format)', async () => {
      const targetActorId = 'https://somewhere.test/actors/request-following'
      const followRequest = await database.getAcceptedOrRequestedFollow({
        actorId: ACTOR1_ID,
        targetActorId
      })
      if (!followRequest) fail('Follow request must exist')

      const activity: AcceptFollow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/activities/accept-1',
        type: 'Accept',
        actor: targetActorId,
        object: `https://llun.test/${followRequest.id}`
      }
      const updatedRequest = await acceptFollowRequest({
        activity,
        database
      })

      expect(updatedRequest).toBeTruthy()
      expect(updatedRequest?.id).toEqual(followRequest.id)
      expect(updatedRequest?.status).toEqual(FollowStatus.enum.Accepted)
    })

    it('resolves follow via recipientActorId fallback when object is an arbitrary URI', async () => {
      const targetActorId = 'https://somewhere.test/actors/request-following'
      const followRequest = await database.getAcceptedOrRequestedFollow({
        actorId: ACTOR1_ID,
        targetActorId
      })
      if (!followRequest) fail('Follow request must exist')

      const activity: AcceptFollow = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://somewhere.test/activities/accept-2',
        type: 'Accept',
        actor: targetActorId,
        object: 'https://somewhere.test/activities/custom-follow-id'
      }
      const updatedRequest = await acceptFollowRequest({
        activity,
        database,
        recipientActorId: ACTOR1_ID
      })

      expect(updatedRequest).toBeTruthy()
      expect(updatedRequest?.id).toEqual(followRequest.id)
    })

    it('does not send duplicate notification alerts if already Accepted', async () => {
      const targetActorId =
        'https://somewhere.test/actors/request-following-dup'
      const followRequest = await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        status: FollowStatus.enum.Accepted,
        inbox: 'https://somewhere.test/inbox',
        sharedInbox: 'https://somewhere.test/inbox'
      })

      const activity = MockFollowRequestResponse({
        actorId: ACTOR1_ID,
        targetActorId,
        followResponseStatus: 'Accept',
        followId: followRequest.id
      }) as AcceptFollow

      const result = await acceptFollowRequest({
        activity,
        database
      })

      expect(result).toBeTruthy()
      expect(result?.status).toEqual(FollowStatus.enum.Accepted)
      expect(sendNotificationAlerts).not.toHaveBeenCalled()
    })

    it('sets follow status to Undo and returns follow with Undo status when actors are blocking', async () => {
      const targetActorId =
        'https://somewhere.test/actors/request-following-blocking'
      const followRequest = await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId,
        status: FollowStatus.enum.Requested,
        inbox: 'https://somewhere.test/inbox',
        sharedInbox: 'https://somewhere.test/inbox'
      })

      vi.spyOn(database, 'isEitherBlocking').mockResolvedValueOnce(true)

      const activity = MockFollowRequestResponse({
        actorId: ACTOR1_ID,
        targetActorId,
        followResponseStatus: 'Accept',
        followId: followRequest.id
      }) as AcceptFollow

      const result = await acceptFollowRequest({
        activity,
        database
      })

      expect(result).toBeTruthy()
      expect(result?.status).toEqual(FollowStatus.enum.Undo)
      const updatedFollow = await database.getFollowFromId({
        followId: followRequest.id
      })
      expect(updatedFollow?.status).toEqual(FollowStatus.enum.Undo)
    })
  })
})
