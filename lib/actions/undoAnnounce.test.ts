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
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
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

  // clearAllMocks drops call history but keeps queued one-shot behaviour, so an
  // unconsumed mockRejectedValueOnce would fire inside a later test.
  afterEach(() => {
    vi.mocked(getQueue().publish).mockReset().mockResolvedValue(undefined)
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

    it('keeps the local delete when queueing the federation job fails', async () => {
      const announceId = `${actor2.id}/statuses/announce-queue-failure`
      await database.createAnnounce({
        id: announceId,
        actorId: actor2.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: `${actor1.id}/statuses/post-1`,
        createdAt: Date.now()
      })
      vi.mocked(getQueue().publish).mockRejectedValueOnce(
        new Error('Queue unavailable')
      )

      await expect(
        userUndoAnnounce({
          currentActor: actor2,
          statusId: announceId,
          database
        })
      ).resolves.not.toBeNull()

      expect(vi.mocked(getQueue().publish)).toHaveBeenCalledTimes(1)
      // The boost is gone either way; a queue outage must not report otherwise.
      await expect(
        database.getStatus({ statusId: announceId, withReplies: false })
      ).resolves.toBeNull()
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
      // A row that still exists: the first test hard-deletes announce-1, and
      // against a missing row this passes whether or not the ownership check
      // is there.
      const announceId = `${actor2.id}/statuses/announce-owned-by-actor2`
      await database.createAnnounce({
        id: announceId,
        actorId: actor2.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: `${actor1.id}/statuses/post-1`,
        createdAt: Date.now()
      })

      const result = await userUndoAnnounce({
        currentActor: actor1,
        statusId: announceId,
        database
      })

      expect(result).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
      // And it is still there — a non-owner must not delete it either.
      await expect(
        database.getStatus({ statusId: announceId, withReplies: false })
      ).resolves.not.toBeNull()
    })
  })
})
