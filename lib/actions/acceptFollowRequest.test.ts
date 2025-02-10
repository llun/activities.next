import { enableFetchMocks } from 'jest-fetch-mock'

import { acceptFollowRequest } from '@/lib/actions//acceptFollowRequest'
import { AcceptFollow } from '@/lib/activities/actions/acceptFollow'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { FollowStatus } from '@/lib/models/follow'
import { sendMail } from '@/lib/services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '@/lib/services/email/templates/follow'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockFollowRequestResponse } from '@/lib/stub/followRequest'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR5_ID } from '@/lib/stub/seed/actor5'

enableFetchMocks()

jest.mock('../services/email', () => ({
  sendMail: jest.fn()
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
  })

  describe('#acceptFollow', () => {
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

    it('sends email when target actor is local account', async () => {
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
      if (!actor5) fail('Actor5 should be exists')
      expect(acceptedRequest?.status).toEqual(FollowStatus.enum.Accepted)
      expect(sendMail).toHaveBeenCalledWith({
        from: 'test@llun.dev',
        to: ['test1@llun.test'],
        subject: getSubject(actor5),
        content: {
          text: getTextContent(actor5),
          html: getHTMLContent(actor5)
        }
      })
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
  })
})
