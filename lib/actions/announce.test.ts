import crypto from 'crypto'

import { userAnnounce } from '@/lib/actions/announce'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { JobData } from '@/lib/jobs/sendAnnounceJob'
import { Actor } from '@/lib/models/actor'
import { Status, StatusType } from '@/lib/models/status'
import { getQueue } from '@/lib/services/queue'
import * as timelinesService from '@/lib/services/timelines'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/jsonld/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

// Mock the queue
jest.mock('../services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('../services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('mocked-uuid')
}))

describe('Announce action', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    actor1 = (await database.getActorFromEmail({
      email: seedActor1.email
    })) as Actor
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('#userAnnounce', () => {
    it('creates announce status and publishes to queue', async () => {
      const status = await userAnnounce({
        currentActor: actor1,
        statusId: `${actor1.id}/statuses/post-2`,
        database
      })

      const originalStatus = await database.getStatus({
        statusId: `${actor1.id}/statuses/post-2`
      })
      expect(status).toMatchObject({
        type: StatusType.enum.Announce,
        originalStatus
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: `announce-${urlToId(status!.id)}`,
        name: SEND_ANNOUNCE_JOB_NAME,
        data: JobData.parse({
          actorId: actor1.id,
          statusId: status!.id
        })
      })

      expect(timelinesService.addStatusToTimelines).toHaveBeenCalledWith(
        database,
        status
      )
    })

    it('does not create duplicate announce', async () => {
      const originalStatusId = `${actor1.id}/statuses/post-3`
      const testDatabase = {
        ...database,
        getStatus: async (params: { statusId: string }) => {
          if (params.statusId === originalStatusId) {
            return { id: originalStatusId } as Status
          }
          return null
        },
        getActorAnnounceStatus: async () =>
          ({ id: 'existing-announce' }) as Status
      }

      const duplicateStatus = await userAnnounce({
        currentActor: actor1,
        statusId: originalStatusId,
        database: testDatabase
      })

      expect(duplicateStatus).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
      expect(timelinesService.addStatusToTimelines).not.toHaveBeenCalled()
    })

    it('returns null when original status does not exist', async () => {
      const result = await userAnnounce({
        currentActor: actor1,
        statusId: 'nonexistent-status',
        database
      })

      expect(result).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
      expect(timelinesService.addStatusToTimelines).not.toHaveBeenCalled()
    })

    it('returns null when createAnnounce fails', async () => {
      const testDatabase = {
        ...database,
        getStatus: async () => ({ id: 'test-status' }) as Status,
        getActorAnnounceStatus: async () => null,
        createAnnounce: async () => null
      }

      const result = await userAnnounce({
        currentActor: actor1,
        statusId: 'test-status',
        database: testDatabase
      })

      expect(result).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
      expect(timelinesService.addStatusToTimelines).not.toHaveBeenCalled()
    })

    it('includes correct recipients in the announce', async () => {
      const testUuid = '12345678-1234-1234-1234-123456789012'
      const expectedId = `${actor1.id}/statuses/${testUuid}`
      const testDatabase = {
        ...database,
        getStatus: async () => ({ id: 'test-status' }) as Status,
        getActorAnnounceStatus: async () => null,
        createAnnounce: async (params: {
          id: string
          actorId: string
          to: string[]
          cc: string[]
          originalStatusId: string
        }) => {
          expect(params).toEqual({
            id: expectedId,
            actorId: actor1.id,
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [actor1.id, actor1.followersUrl],
            originalStatusId: 'test-status'
          })

          return {
            id: params.id,
            type: StatusType.enum.Announce,
            actorId: params.actorId,
            originalStatus: { id: 'test-status' }
          } as Status
        }
      }

      jest.spyOn(crypto, 'randomUUID').mockReturnValue(testUuid)

      const status = await userAnnounce({
        currentActor: actor1,
        statusId: 'test-status',
        database: testDatabase
      })

      expect(status).not.toBeNull()
      expect(status!.id).toBe(expectedId)
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(timelinesService.addStatusToTimelines).toHaveBeenCalledTimes(1)
    })

    it('creates announce with correct activity format', async () => {
      const testUuid = '87654321-4321-4321-4321-210987654321'
      const announceStatusId = `${actor1.id}/statuses/${testUuid}`
      const originalStatusId = `${actor1.id}/statuses/post-2`

      const testDatabase = {
        ...database,
        getStatus: async (params: { statusId: string }) => {
          if (params.statusId === originalStatusId) {
            return { id: originalStatusId } as Status
          }
          return null
        },
        getActorAnnounceStatus: async () => null,
        createAnnounce: async (params: {
          id: string
          actorId: string
          to: string[]
          cc: string[]
          originalStatusId: string
        }) => {
          return {
            id: params.id,
            type: StatusType.enum.Announce,
            actorId: params.actorId,
            originalStatus: { id: originalStatusId }
          } as Status
        }
      }

      jest.spyOn(crypto, 'randomUUID').mockReturnValue(testUuid)

      await userAnnounce({
        currentActor: actor1,
        statusId: originalStatusId,
        database: testDatabase
      })

      expect(getQueue().publish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: SEND_ANNOUNCE_JOB_NAME,
          data: expect.objectContaining({
            actorId: actor1.id,
            statusId: announceStatusId
          })
        })
      )
    })
  })
})
