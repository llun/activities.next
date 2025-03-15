import { userUndoAnnounce } from '@/lib/actions/undoAnnounce'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UNDO_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { JobData } from '@/lib/jobs/sendUndoAnnounceJob'
import { Actor } from '@/lib/models/actor'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// Mock the queue
jest.mock('../services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

describe('Undo Announce action', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor
  let actor2: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    actor1 = (await database.getActorFromEmail({
      email: seedActor1.email
    })) as Actor
    actor2 = (await database.getActorFromEmail({
      email: seedActor2.email
    })) as Actor
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('#userUndoAnnounce', () => {
    it('deletes announce status and publishes to queue', async () => {
      const status = await userUndoAnnounce({
        currentActor: actor2,
        statusId: `${actor2.id}/statuses/announce-1`,
        database
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(status!.id),
        name: SEND_UNDO_ANNOUNCE_JOB_NAME,
        data: JobData.parse({
          actorId: actor2.id,
          statusId: status!.id
        })
      })
    })

    it('returns null when status does not exist', async () => {
      const result = await userUndoAnnounce({
        currentActor: actor2,
        statusId: 'nonexistent-status',
        database
      })

      expect(result).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('returns null when status is not an announce', async () => {
      const result = await userUndoAnnounce({
        currentActor: actor2,
        statusId: `${actor2.id}/statuses/post-2`,
        database
      })

      expect(result).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('returns null when status is not owned by the current actor', async () => {
      const result = await userUndoAnnounce({
        currentActor: actor1,
        statusId: `${actor2.id}/statuses/announce-1`,
        database
      })

      expect(result).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
    })
  })
})
