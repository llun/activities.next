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
import { getHashFromString } from '@/lib/utils/getHashFromString'

jest.mock('../services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('../services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
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
        id: getHashFromString(status!.id),
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
  })
})
