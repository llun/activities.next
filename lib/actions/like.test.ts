import { enableFetchMocks } from 'jest-fetch-mock'

import { AcceptFollow } from '../activities/actions/acceptFollow'
import { Note } from '../activities/entities/note'
import { FollowStatus } from '../models/follow'
import { StatusType } from '../models/status'
import { Sqlite3Storage } from '../storage/sqlite3'
import { mockRequests } from '../stub/activities'
import { MockFollowRequestResponse } from '../stub/followRequest'
import { ACTOR1_ID } from '../stub/seed/actor1'
import { ACTOR2_ID } from '../stub/seed/actor2'
import { seedStorage } from '../stub/storage'
import { acceptFollowRequest } from './acceptFollowRequest'
import { likeRequest } from './like'

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

  describe('#likeRequest', () => {
    it('create new like with actor id and status in the database', async () => {
      await likeRequest({
        activity: {
          actor: ACTOR2_ID,
          id: `${ACTOR2_ID}/like-post1`,
          type: 'Like',
          object: `${ACTOR1_ID}/statuses/post-1`
        },
        storage
      })
      const status = await storage.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-1`
      })
      if (status?.data.type !== StatusType.Note) {
        fail('Status type must be note')
      }

      expect(status?.data.totalLikes).toEqual(1)
    })

    it('create new like base on Note object', async () => {
      const status = await storage.getStatus({
        statusId: `${ACTOR2_ID}/statuses/post-2`
      })
      await likeRequest({
        activity: {
          actor: ACTOR1_ID,
          id: `${ACTOR1_ID}/like-post-2`,
          type: 'Like',
          object: status?.toObject() as Note
        },
        storage
      })
      const afterLikeStatus = await storage.getStatus({
        statusId: `${ACTOR2_ID}/statuses/post-2`
      })
      if (afterLikeStatus?.data.type !== StatusType.Note) {
        fail('Status type must be note')
      }

      expect(afterLikeStatus?.data.totalLikes).toEqual(1)
    })
  })
})
