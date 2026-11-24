import { buildAnnounceActivity } from '@/lib/activities'
import { DELIVERY_FAILURE_DAYS_THRESHOLD } from '@/lib/database/domains/deliveryInboxes/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  DELIVER_ACTIVITY_JOB_NAME,
  SEND_ANNOUNCE_JOB_NAME
} from '@/lib/jobs/names'
import { sendAnnounceJob } from '@/lib/jobs/sendAnnounceJob'
import { getDeliveryJobId } from '@/lib/services/federation/enqueueDeliveries'
import { storeBlueskyPost } from '@/lib/stub/blueskyPost'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

const publish = vi.fn()
const mockGetQueue = vi.fn()

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => mockGetQueue()
}))

vi.mock('@/lib/activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/activities')>()
  return {
    ...actual,
    buildAnnounceActivity: vi.fn(actual.buildAnnounceActivity)
  }
})

describe('sendAnnounceJob', () => {
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

  it('does nothing when status is not found', async () => {
    if (!actor1) fail('Actor1 is required')

    await expect(
      sendAnnounceJob(database, {
        id: 'job-1',
        name: SEND_ANNOUNCE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: 'https://nonexistent.test/statuses/missing'
        }
      })
    ).resolves.toBeUndefined()

    expect(publish).not.toHaveBeenCalled()
  })

  it('does nothing when actor is not found', async () => {
    if (!actor1) fail('Actor1 is required')

    const statusId = `${actor1.id}/statuses/for-announce-test`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Test status',
      createdAt: Date.now()
    })

    await expect(
      sendAnnounceJob(database, {
        id: 'job-2',
        name: SEND_ANNOUNCE_JOB_NAME,
        data: {
          actorId: 'https://nonexistent.test/users/nobody',
          statusId
        }
      })
    ).resolves.toBeUndefined()

    expect(publish).not.toHaveBeenCalled()
  })

  it('publishes Announce to available follower inboxes with dedup ids and skips unavailable inboxes', async () => {
    if (!actor1) fail('Actor1 is required')

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

    const originalStatusId = `${actor1.id}/statuses/original-to-boost`
    await database.createNote({
      id: originalStatusId,
      url: originalStatusId,
      actorId: actor1.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Original content',
      createdAt: Date.now()
    })

    const createdAt = 1700000000000
    const announceId = `${actor1.id}/statuses/announce-job-test`
    await database.createAnnounce({
      id: announceId,
      actorId: actor1.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId,
      createdAt
    })

    await sendAnnounceJob(database, {
      id: 'announce-job-3',
      name: SEND_ANNOUNCE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId: announceId
      }
    })

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith({
      id: getDeliveryJobId('announce-job-3', 'https://somewhere.test/inbox'),
      name: DELIVER_ACTIVITY_JOB_NAME,
      data: {
        inbox: 'https://somewhere.test/inbox',
        actorId: actor1.id,
        activity: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${announceId}/activity`,
          type: 'Announce',
          actor: actor1.id,
          published: getISOTimeUTC(createdAt),
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          object: originalStatusId
        }
      }
    })
  })

  it('refuses to federate an Announce whose original is a Bluesky post', async () => {
    if (!actor1) fail('Actor1 is required')
    const { statusId: blueskyPostId } = await storeBlueskyPost(
      database,
      'sendannounce'
    )
    const announceId = `${actor1.id}/statuses/announce-bluesky`
    await database.createAnnounce({
      id: announceId,
      actorId: actor1.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: blueskyPostId,
      createdAt: 1700000000000
    })

    // Pin sendAnnounceJob's own guard independently of buildAnnounceActivity's
    // guard by having the mocked builder return an activity if reached.
    vi.mocked(buildAnnounceActivity).mockReturnValueOnce({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${announceId}/activity`,
      type: 'Announce',
      actor: actor1.id,
      published: getISOTimeUTC(1700000000000),
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      object: blueskyPostId
    })
    const followersSpy = vi.spyOn(database, 'getFollowersInbox')
    try {
      await sendAnnounceJob(database, {
        id: 'announce-bluesky-job',
        name: SEND_ANNOUNCE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId: announceId
        }
      })

      expect(buildAnnounceActivity).not.toHaveBeenCalled()
      expect(followersSpy).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    } finally {
      followersSpy.mockRestore()
    }
  })
})
