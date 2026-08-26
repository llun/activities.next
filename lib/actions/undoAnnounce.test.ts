import { userUndoAnnounce } from '@/lib/actions/undoAnnounce'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { SEND_UNDO_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { JobData } from '@/lib/jobs/sendUndoAnnounceJob'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'
import { StatusAnnounce } from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// Mock the queue
vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
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
    vi.clearAllMocks()
  })

  describe('userUndoAnnounce', () => {
    it('deletes announce status and publishes to queue', async () => {
      const deleteSpy = vi.spyOn(database, 'deleteStatus')
      const status = await userUndoAnnounce({
        currentActor: actor2,
        statusId: `${actor2.id}/statuses/announce-1`,
        database
      })

      const announce = status as StatusAnnounce
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
      expect(getQueue().publish).toHaveBeenCalledWith({
        id: getHashFromString(`${announce.id}#undo`),
        name: SEND_UNDO_ANNOUNCE_JOB_NAME,
        data: JobData.parse({
          actorId: actor2.id,
          statusId: announce.id,
          originalStatusId: announce.originalStatus.id,
          to: announce.to,
          cc: announce.cc,
          createdAt: announce.createdAt
        })
      })

      // The job resolves everything from that payload precisely because the
      // row is already gone when it runs.
      const publishOrder = vi.mocked(getQueue().publish).mock
        .invocationCallOrder[0]
      expect(deleteSpy.mock.invocationCallOrder[0]).toBeLessThan(publishOrder)
      deleteSpy.mockRestore()

      // SendAnnounceJob publishes under getHashFromString(status.id) and the
      // queue deduplicates on this id across job names, so reusing it makes a
      // boost followed by an unboost drop the Undo entirely.
      const published = vi.mocked(getQueue().publish).mock.calls[0][0]
      expect(published.id).not.toBe(getHashFromString(announce.id))
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
