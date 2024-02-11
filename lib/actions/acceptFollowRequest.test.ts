import { enableFetchMocks } from 'jest-fetch-mock'

import { AcceptFollow } from '../activities/actions/acceptFollow'
import { FollowStatus } from '../models/follow'
import { sendMail } from '../services/email'
import {
  getHTMLContent,
  getSubject,
  getTextContent
} from '../services/email/templates/follow'
import { SqlStorage } from '../storage/sql'
import { mockRequests } from '../stub/activities'
import { MockFollowRequestResponse } from '../stub/followRequest'
import { ACTOR1_ID } from '../stub/seed/actor1'
import { ACTOR5_ID } from '../stub/seed/actor5'
import { seedStorage } from '../stub/storage'
import { acceptFollowRequest } from './acceptFollowRequest'

enableFetchMocks()

jest.mock('../services/email', () => ({
  sendMail: jest.fn()
}))

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
      expect(acceptedRequest?.status).toEqual(FollowStatus.enum.Accepted)
    })

    it('sends email when target actor is local account', async () => {
      const followRequest = await storage.getAcceptedOrRequestedFollow({
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
      const updatedRequest = await acceptFollowRequest({ activity, storage })
      expect(updatedRequest).toBeTruthy()

      const acceptedRequest = await storage.getFollowFromId({
        followId: followRequest.id
      })
      const actor5 = await storage.getActorFromId({ id: ACTOR5_ID })
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
      const updatedRequest = await acceptFollowRequest({ activity, storage })
      expect(updatedRequest).toBeNull()
    })
  })
})
