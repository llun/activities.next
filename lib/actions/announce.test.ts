import { enableFetchMocks } from 'jest-fetch-mock'

import { StatusType } from '../models/status'
import { Sqlite3Storage } from '../storage/sqlite3'
import { mockRequests } from '../stub/activities'
import { MockAnnounceStatus } from '../stub/announce'
import { stubNoteId } from '../stub/note'
import { seedStorage } from '../stub/storage'
import { announce } from './announce'

enableFetchMocks()

jest.mock('../config', () => ({
  __esModule: true,
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test'
  })
}))

describe('Announce action', () => {
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

  describe('#announce', () => {
    it('loads announce status and save it locally', async () => {
      const statusId = stubNoteId()
      const announceStatusId = 'https://somewhere.test/statuses/announce-status'
      await announce({
        status: MockAnnounceStatus({
          actorId: 'https://llun.test/users/test1',
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
  })
})
