import { DELIVERY_FAILURE_DAYS_THRESHOLD } from '@/lib/database/domains/deliveryInboxes/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { JOBS } from '@/lib/jobs'
import {
  DELIVER_ACTIVITY_JOB_NAME,
  SEND_UNDO_ANNOUNCE_JOB_NAME
} from '@/lib/jobs/names'
import { sendUndoAnnounceJob } from '@/lib/jobs/sendUndoAnnounceJob'
import { getDeliveryJobId } from '@/lib/services/federation/enqueueDeliveries'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_FOLLOWER_URL, seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

const publish = vi.fn()
const mockGetQueue = vi.fn()

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => mockGetQueue()
}))

const FOLLOWERS_SHARED_INBOX = 'https://somewhere.test/inbox'

describe('sendUndoAnnounceJob', () => {
  const { database, db, prepare } = createTestDatabase()
  let actor1: Actor | null | undefined

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    publish.mockReset().mockResolvedValue(undefined)
    mockGetQueue.mockReturnValue({
      runsInline: false,
      dropsDelayedJobs: false,
      publish,
      handle: vi.fn()
    })
    await db.deleteFrom('delivery_inbox_failures').execute()
    if (actor1?.id) {
      await db
        .deleteFrom('follows')
        .where('targetActorId', '=', actor1.id)
        .where('actorId', '!=', 'https://somewhere.test/actors/friend')
        .execute()
    }
  })

  it('is registered under its job name', () => {
    expect(JOBS[SEND_UNDO_ANNOUNCE_JOB_NAME]).toBe(sendUndoAnnounceJob)
  })

  // The Announce row is ALWAYS gone by the time this job runs - userUndoAnnounce
  // hard-deletes it before publishing - so the ids below are deliberately absent
  // from the database. Seeding the announce here (as this test used to) makes
  // the job pass against code that always fails in production.
  it('publishes the undo for an announce that no longer exists and skips unavailable inboxes', async () => {
    if (!actor1) fail('Actor1 is required')
    const announceId = `${actor1.id}/statuses/announce-already-deleted`
    const originalStatusId = 'https://somewhere.test/actors/friend/statuses/1'
    const createdAt = 1700000000000

    await expect(
      database.getStatus({ statusId: announceId, withReplies: false })
    ).resolves.toBeNull()

    await database.createFollow({
      actorId: 'https://dead.example/actors/follower2',
      targetActorId: actor1.id,
      inbox: 'https://dead.example/inbox',
      sharedInbox: 'https://dead.example/inbox',
      status: FollowStatus.enum.Accepted
    })
    const failureAt = Date.now()
    for (let day = 1; day <= DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      await database.recordDeliveryFailure({
        inbox: 'https://dead.example/inbox',
        error: 'HTTP 503',
        now:
          failureAt -
          (DELIVERY_FAILURE_DAYS_THRESHOLD - day) * 24 * 60 * 60 * 1000
      })
    }

    await sendUndoAnnounceJob(database, {
      id: 'undo-announce-job-1',
      name: SEND_UNDO_ANNOUNCE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId: announceId,
        originalStatusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [ACTOR1_FOLLOWER_URL],
        createdAt
      }
    })

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith({
      id: getDeliveryJobId('undo-announce-job-1', FOLLOWERS_SHARED_INBOX),
      name: DELIVER_ACTIVITY_JOB_NAME,
      data: {
        inbox: FOLLOWERS_SHARED_INBOX,
        actorId: actor1.id,
        activity: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${announceId}#undo`,
          type: 'Undo',
          actor: actor1.id,
          to: [ACTIVITY_STREAM_PUBLIC],
          object: {
            id: `${announceId}/activity`,
            type: 'Announce',
            actor: actor1.id,
            published: getISOTimeUTC(createdAt),
            to: [ACTIVITY_STREAM_PUBLIC],
            cc: [ACTOR1_FOLLOWER_URL],
            object: originalStatusId
          }
        }
      }
    })
  })

  it('does nothing if actor is not found', async () => {
    const followersSpy = vi.spyOn(database, 'getFollowersInbox')

    await sendUndoAnnounceJob(database, {
      id: 'job-id',
      name: SEND_UNDO_ANNOUNCE_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/not-exist-actor',
        statusId: 'https://llun.test/users/not-exist-actor/statuses/announce-1',
        originalStatusId: 'https://somewhere.test/actors/friend/statuses/1',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        createdAt: 1700000000000
      }
    })

    expect(followersSpy).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    followersSpy.mockRestore()
  })

  it('rejects a payload missing the announce data it can no longer look up', async () => {
    if (!actor1) fail('Actor1 is required')

    await expect(
      sendUndoAnnounceJob(database, {
        id: 'job-id',
        name: SEND_UNDO_ANNOUNCE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: `${actor1.id}/statuses/announce-legacy`
        }
      })
    ).rejects.toThrow()

    expect(publish).not.toHaveBeenCalled()
  })
})
