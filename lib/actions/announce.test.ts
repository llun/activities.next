import { enableFetchMocks } from 'jest-fetch-mock'

import { Actor } from '../models/actor'
import { StatusType } from '../models/status'
import { Sqlite3Storage } from '../storage/sqlite3'
import { mockRequests } from '../stub/activities'
import { MockAnnounceStatus } from '../stub/announce'
import { stubNoteId } from '../stub/note'
import { ACTOR1_ID, seedActor1 } from '../stub/seed/actor1'
import { seedStorage } from '../stub/storage'
import { announce } from './announce'

enableFetchMocks()

jest.mock('../config')

describe('Announce action', () => {
  const storage = new Sqlite3Storage({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  let actor1: Actor | undefined

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)

    actor1 = await storage.getActorFromEmail({ email: seedActor1.email })
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  describe('#announce', () => {
    it('loads announce status and save it locally', async () => {
      const statusId = stubNoteId()
      const announceStatusId = 'https://somewhere.test/statuses/announce-status'
      await announce({
        status: MockAnnounceStatus({
          actorId: ACTOR1_ID,
          statusId,
          announceStatusId
        }),
        storage
      })

      const status = await storage.getStatus({
        statusId: `${statusId}/activity`
      })
      expect(status).toBeDefined()

      const boostedStatus = await storage.getStatus({
        statusId: announceStatusId
      })
      const statusData = status?.toJson()
      if (statusData?.type !== StatusType.Announce) {
        fail('Status type must be announce')
      }
      expect(statusData.originalStatus).toEqual(boostedStatus?.toJson())
    })

    it('does not load and create status that already exists', async () => {
      const statusId = stubNoteId()
      const announceStatusId = `${actor1?.id}/statuses/post-1`
      await announce({
        status: MockAnnounceStatus({
          actorId: ACTOR1_ID,
          statusId,
          announceStatusId
        }),
        storage
      })
      expect(fetchMock).not.toHaveBeenCalledWith(announceStatusId)
    })
  })
})
