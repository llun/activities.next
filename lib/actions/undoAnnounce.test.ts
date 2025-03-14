import { userUndoAnnounce } from '@/lib/actions/undoAnnounce'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UNDO_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { JobData } from '@/lib/jobs/sendUndoAnnounceJob'
import { Actor } from '@/lib/models/actor'
import { Status, StatusType } from '@/lib/models/status'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { urlToId } from '@/lib/utils/urlToId'

// Mock the queue
jest.mock('../services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

describe('Undo Announce action', () => {
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

  describe('#userUndoAnnounce', () => {
    it('deletes announce status and publishes to queue', async () => {
      const announceStatus = {
        id: `${actor1.id}/statuses/announce-1`,
        type: StatusType.enum.Announce
      } as Status

      const mockDatabase = {
        ...database,
        getStatus: jest.fn().mockResolvedValue(announceStatus),
        deleteStatus: jest.fn().mockResolvedValue(true)
      }

      const status = await userUndoAnnounce({
        currentActor: actor1,
        statusId: announceStatus.id,
        database: mockDatabase
      })

      expect(status).toEqual(announceStatus)
      expect(mockDatabase.deleteStatus).toHaveBeenCalledWith({
        statusId: announceStatus.id
      })

      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: `undo-announce-${urlToId(announceStatus.id)}`,
        name: SEND_UNDO_ANNOUNCE_JOB_NAME,
        data: JobData.parse({
          actorId: actor1.id,
          statusId: announceStatus.id
        })
      })
    })

    it('returns null when status does not exist', async () => {
      const mockDatabase = {
        ...database,
        getStatus: jest.fn().mockResolvedValue(null)
      }

      const result = await userUndoAnnounce({
        currentActor: actor1,
        statusId: 'nonexistent-status',
        database: mockDatabase
      })

      expect(result).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('returns null when status is not an announce', async () => {
      const noteStatus = {
        id: `${actor1.id}/statuses/note-1`,
        type: StatusType.enum.Note
      } as Status

      const mockDatabase = {
        ...database,
        getStatus: jest.fn().mockResolvedValue(noteStatus)
      }

      const result = await userUndoAnnounce({
        currentActor: actor1,
        statusId: noteStatus.id,
        database: mockDatabase
      })

      expect(result).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
    })
  })
})
