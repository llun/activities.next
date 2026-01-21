import { userAnnounce } from '@/lib/actions/announce'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { NotificationType } from '@/lib/database/types/notification'
import { SEND_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { JobData } from '@/lib/jobs/sendAnnounceJob'
import { Actor } from '@/lib/models/actor'
import { Status, StatusType } from '@/lib/models/status'
import { getQueue } from '@/lib/services/queue'
import * as timelinesService from '@/lib/services/timelines'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { getHashFromString } from '@/lib/utils/getHashFromString'

jest.mock('../services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('../services/timelines', () => ({
  addStatusToTimelines: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('../services/email', () => ({
  sendMail: jest.fn()
}))

describe('Announce action', () => {
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

  describe('reblog notifications', () => {
    it("creates reblog notification when announcing another user's status", async () => {
      // Get actor2's status from seeded data (actor2 has post-2 which replies to actor1)
      const actor2Status = await database.getStatus({
        statusId: `${actor2.id}/statuses/post-2`
      })

      expect(actor2Status).not.toBeNull()

      // Actor1 announces actor2's status
      const announceStatus = await userAnnounce({
        currentActor: actor1,
        statusId: actor2Status!.id,
        database
      })

      expect(announceStatus).not.toBeNull()

      // Check that a reblog notification was created
      const notifications = await database.getNotifications({
        actorId: actor2.id,
        limit: 10
      })

      const reblogNotification = notifications.find(
        (n) =>
          n.type === NotificationType.enum.reblog &&
          n.sourceActorId === actor1.id &&
          n.statusId === actor2Status!.id
      )

      expect(reblogNotification).toBeDefined()
      expect(reblogNotification?.groupKey).toBe(`reblog:${actor2Status!.id}`)
    })

    it('does not create reblog notification when announcing own status', async () => {
      const ownStatus = await database.getStatus({
        statusId: `${actor1.id}/statuses/post-1`
      })

      expect(ownStatus).not.toBeNull()

      // Clear any existing notifications for actor1
      const existingNotifications = await database.getNotifications({
        actorId: actor1.id,
        limit: 100
      })
      for (const notif of existingNotifications) {
        await database.deleteNotification(notif.id)
      }

      // Actor1 announces their own status
      const announceStatus = await userAnnounce({
        currentActor: actor1,
        statusId: ownStatus!.id,
        database
      })

      expect(announceStatus).not.toBeNull()

      // Check that NO reblog notification was created
      const notifications = await database.getNotifications({
        actorId: actor1.id,
        limit: 10
      })

      const reblogNotification = notifications.find(
        (n) => n.type === NotificationType.enum.reblog
      )

      expect(reblogNotification).toBeUndefined()
    })

    it('sets correct notification sourceActorId', async () => {
      const actor2Status = await database.getStatus({
        statusId: `${actor2.id}/statuses/post-2`
      })

      expect(actor2Status).not.toBeNull()

      await userAnnounce({
        currentActor: actor1,
        statusId: actor2Status!.id,
        database
      })

      const notifications = await database.getNotifications({
        actorId: actor2.id,
        limit: 10
      })

      const reblogNotification = notifications.find(
        (n) =>
          n.type === NotificationType.enum.reblog &&
          n.statusId === actor2Status!.id
      )

      expect(reblogNotification?.sourceActorId).toBe(actor1.id)
    })
  })
})
