import { userAnnounce } from '@/lib/actions/announce'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { SEND_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { JobData } from '@/lib/jobs/sendAnnounceJob'
import { getQueue } from '@/lib/services/queue'
import * as timelinesService from '@/lib/services/timelines'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { isPublicId } from '@/lib/utils/publicId'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/email', () => ({
  sendMail: vi.fn()
}))

describe('Announce action', () => {
  // A fresh seeded database per test: two tests announce actor2's post-2, and
  // userAnnounce returns null for a status the actor has already announced, so
  // on a shared database whichever of them ran second got null.
  let database: Database
  let actor1: Actor
  let actor2: Actor

  beforeEach(async () => {
    vi.clearAllMocks()
    database = getTestSQLDatabase()
    await database.migrate()
    await seedDatabase(database)

    actor1 = (await database.getActorFromEmail({
      email: seedActor1.email
    })) as Actor
    actor2 = (await database.getActorFromEmail({
      email: seedActor2.email
    })) as Actor
  })

  afterEach(async () => {
    await database.destroy()
  })

  describe('userAnnounce', () => {
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

    it('mints the new status URI tail from a v7 publicId', async () => {
      const status = await userAnnounce({
        currentActor: actor1,
        statusId: `${actor1.id}/statuses/post-3`,
        database
      })

      expect(status?.publicId).toBeTruthy()
      expect(isPublicId(status?.publicId as string)).toBe(true)
      expect(status?.id).toBe(`${actor1.id}/statuses/${status?.publicId}`)
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

  // Mastodon's StatusPolicy#reblog?: only a status the booster can read AND
  // that is public/unlisted may be boosted; the booster's own followers-only
  // post may be boosted back to the same followers only; direct posts never.
  describe('boostability', () => {
    const createNote = (
      actor: Actor,
      suffix: string,
      to: string[],
      cc: string[] = []
    ) =>
      database.createNote({
        id: `${actor.id}/statuses/${suffix}`,
        url: `${actor.id}/statuses/${suffix}`,
        actorId: actor.id,
        text: suffix,
        to,
        cc
      })

    const followAccepted = (follower: Actor, target: Actor) =>
      database.createFollow({
        actorId: follower.id,
        targetActorId: target.id,
        inbox: `${follower.id}/inbox`,
        sharedInbox: `${follower.id}/inbox`,
        status: FollowStatus.enum.Accepted
      })

    const expectNothingAnnounced = async (statusId: string) => {
      expect(
        await database.getActorAnnounceStatus({
          statusId,
          actorId: actor1.id
        })
      ).toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
      expect(timelinesService.addStatusToTimelines).not.toHaveBeenCalled()
    }

    it("refuses another actor's followers-only status even for an accepted follower", async () => {
      await followAccepted(actor1, actor2)
      const note = await createNote(actor2, 'followers-only', [
        actor2.followersUrl
      ])

      const result = await userAnnounce({
        currentActor: actor1,
        statusId: note.id,
        database
      })

      expect(result).toBeNull()
      await expectNothingAnnounced(note.id)
    })

    it('refuses a direct status addressed to the booster', async () => {
      const note = await createNote(actor2, 'direct', [actor1.id])

      const result = await userAnnounce({
        currentActor: actor1,
        statusId: note.id,
        database
      })

      expect(result).toBeNull()
      await expectNothingAnnounced(note.id)
    })

    it('refuses a status the booster cannot read at all', async () => {
      // The deprecated repost route hands userAnnounce a raw id with no read
      // check of its own, so this gate is the only one on that path.
      const note = await createNote(actor2, 'unreadable', [actor2.followersUrl])

      const result = await userAnnounce({
        currentActor: actor1,
        statusId: note.id,
        database
      })

      expect(result).toBeNull()
      await expectNothingAnnounced(note.id)
    })

    it('refuses a public boost whose original is no longer public', async () => {
      await followAccepted(actor1, actor2)
      const note = await createNote(actor2, 'narrowed', [actor2.followersUrl])
      const boost = await database.createAnnounce({
        id: `${actor2.id}/statuses/narrowed-boost`,
        actorId: actor2.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [actor2.followersUrl],
        originalStatusId: note.id
      })

      const result = await userAnnounce({
        currentActor: actor1,
        statusId: boost!.id,
        database
      })

      expect(result).toBeNull()
      await expectNothingAnnounced(boost!.id)
    })

    it("allows another actor's unlisted status", async () => {
      const note = await createNote(
        actor2,
        'unlisted',
        [actor2.followersUrl],
        [ACTIVITY_STREAM_PUBLIC]
      )

      const result = await userAnnounce({
        currentActor: actor1,
        statusId: note.id,
        database
      })

      expect(result?.to).toEqual([ACTIVITY_STREAM_PUBLIC])
    })

    it('boosts an own followers-only status only back to the same followers', async () => {
      const note = await createNote(actor1, 'own-followers-only', [
        actor1.followersUrl
      ])

      const result = await userAnnounce({
        currentActor: actor1,
        statusId: note.id,
        database,
        visibility: 'public'
      })

      expect(result).not.toBeNull()
      const recipients = [...result!.to, ...result!.cc]
      expect(recipients).not.toContain(ACTIVITY_STREAM_PUBLIC)
      expect(recipients).toContain(actor1.followersUrl)
    })

    it('refuses an own direct status', async () => {
      const note = await createNote(actor1, 'own-direct', [actor2.id])

      const result = await userAnnounce({
        currentActor: actor1,
        statusId: note.id,
        database
      })

      expect(result).toBeNull()
      await expectNothingAnnounced(note.id)
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
