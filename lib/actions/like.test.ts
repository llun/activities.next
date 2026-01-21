import { enableFetchMocks } from 'jest-fetch-mock'

import { likeRequest } from '@/lib/actions/like'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Status, StatusNote, toActivityPubObject } from '@/lib/models/status'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

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

  describe('#likeRequest', () => {
    it('create new like with actor id and status in the database', async () => {
      await likeRequest({
        activity: {
          actor: ACTOR2_ID,
          id: `${ACTOR2_ID}/like-post1`,
          type: 'Like',
          object: `${ACTOR1_ID}/statuses/post-1`
        },
        database
      })
      const status = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })) as StatusNote
      expect(status.totalLikes).toEqual(1)
    })

    it('create new like base on Note object', async () => {
      const status = (await database.getStatus({
        statusId: `${ACTOR2_ID}/statuses/post-2`
      })) as Status
      await likeRequest({
        activity: {
          actor: ACTOR1_ID,
          id: `${ACTOR1_ID}/like-post-2`,
          type: 'Like',
          object: toActivityPubObject(status)
        },
        database
      })
      const afterLikeStatus = (await database.getStatus({
        statusId: `${ACTOR2_ID}/statuses/post-2`
      })) as StatusNote
      expect(afterLikeStatus.totalLikes).toEqual(1)
    })
  })
})
