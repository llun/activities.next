import { DELIVERY_FAILURE_DAYS_THRESHOLD } from '@/lib/database/domains/deliveryDomains/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { JOBS } from '@/lib/jobs'
import {
  DELIVER_ACTIVITY_JOB_NAME,
  SEND_DELETE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { sendDeleteNoteJob } from '@/lib/jobs/sendDeleteNoteJob'
import { getDeliveryJobId } from '@/lib/services/federation/enqueueDeliveries'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_FOLLOWER_URL, seedActor1 } from '@/lib/stub/seed/actor1'
import {
  EXTERNAL_ACTOR1,
  EXTERNAL_ACTOR1_INBOX
} from '@/lib/stub/seed/external1'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const publish = vi.fn()
const mockGetQueue = vi.fn()

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => mockGetQueue()
}))

const mockQueue = (runsInline = false) => {
  mockGetQueue.mockReturnValue({
    runsInline,
    dropsDelayedJobs: runsInline,
    publish,
    handle: vi.fn()
  })
}

const FOLLOWERS_SHARED_INBOX = 'https://somewhere.test/inbox'

describe('sendDeleteNoteJob', () => {
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
    mockQueue(false)
    await db.deleteFrom('delivery_domain_failures').execute()
  })

  it('is registered under its job name', () => {
    expect(JOBS[SEND_DELETE_NOTE_JOB_NAME]).toBe(sendDeleteNoteJob)
  })

  // Every delivery case below deliberately uses a statusId that is not in the
  // database: the row is always gone by the time this job runs.
  it('publishes the delete activity for a status that no longer exists and skips unavailable domains', async () => {
    if (!actor1) fail('Actor1 is required')
    const statusId = `${actor1.id}/statuses/already-deleted`

    // Confirm the statusId is absent from the database before running.
    await expect(
      database.getStatus({ statusId, withReplies: false })
    ).resolves.toBeNull()

    const externalDomain = new URL(EXTERNAL_ACTOR1_INBOX).hostname
    for (let day = 1; day <= DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      await database.recordDeliveryFailure({
        domain: externalDomain,
        error: 'HTTP 503',
        now: Date.parse(`2026-11-0${day}T00:00:00.000Z`)
      })
    }

    await sendDeleteNoteJob(database, {
      id: 'delete-job-1',
      name: SEND_DELETE_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId,
        to: [ACTIVITY_STREAM_PUBLIC, EXTERNAL_ACTOR1],
        cc: [ACTOR1_FOLLOWER_URL]
      }
    })

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith({
      id: getDeliveryJobId('delete-job-1', FOLLOWERS_SHARED_INBOX),
      name: DELIVER_ACTIVITY_JOB_NAME,
      data: {
        inbox: FOLLOWERS_SHARED_INBOX,
        actorId: actor1.id,
        activity: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${statusId}#delete`,
          type: 'Delete',
          actor: actor1.id,
          to: [ACTIVITY_STREAM_PUBLIC],
          object: {
            id: statusId,
            type: 'Tombstone'
          }
        }
      }
    })
  })

  it('addresses a non-direct delete to the public audience rather than the original recipients', async () => {
    if (!actor1) fail('Actor1 is required')
    const statusId = `${actor1.id}/statuses/followers-only-deleted`

    await sendDeleteNoteJob(database, {
      id: 'delete-job-2',
      name: SEND_DELETE_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId,
        to: [ACTOR1_FOLLOWER_URL],
        cc: []
      }
    })

    expect(publish).toHaveBeenCalledTimes(1)
    const publishedActivity = publish.mock.calls[0][0].data.activity
    expect(publishedActivity.to).toEqual([ACTIVITY_STREAM_PUBLIC])
    expect(publishedActivity.cc).toBeUndefined()
  })

  it('preserves the original recipients for a direct status', async () => {
    if (!actor1) fail('Actor1 is required')
    const statusId = `${actor1.id}/statuses/direct-deleted`

    await sendDeleteNoteJob(database, {
      id: 'delete-job-3',
      name: SEND_DELETE_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId,
        to: [EXTERNAL_ACTOR1],
        cc: []
      }
    })

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith({
      id: getDeliveryJobId('delete-job-3', EXTERNAL_ACTOR1_INBOX),
      name: DELIVER_ACTIVITY_JOB_NAME,
      data: {
        inbox: EXTERNAL_ACTOR1_INBOX,
        actorId: actor1.id,
        activity: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${statusId}#delete`,
          type: 'Delete',
          actor: actor1.id,
          to: [EXTERNAL_ACTOR1],
          cc: [],
          object: {
            id: statusId,
            type: 'Tombstone'
          }
        }
      }
    })
  })

  it('does nothing if actor is not found', async () => {
    await sendDeleteNoteJob(database, {
      id: 'job-id',
      name: SEND_DELETE_NOTE_JOB_NAME,
      data: {
        actorId: 'https://llun.test/users/not-exist-actor',
        statusId: 'https://llun.test/users/not-exist-actor/statuses/post-1',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      }
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('keeps delivering to the other inboxes when one inline send rejects', async () => {
    if (!actor1) fail('Actor1 is required')
    const statusId = `${actor1.id}/statuses/partial-failure`

    mockQueue(true)
    publish.mockImplementation(async (msg) => {
      if (msg.data.inbox === FOLLOWERS_SHARED_INBOX) {
        throw new Error('Inbox unreachable')
      }
    })

    await expect(
      sendDeleteNoteJob(database, {
        id: 'delete-job-inline',
        name: SEND_DELETE_NOTE_JOB_NAME,
        data: {
          actorId: actor1.id,
          statusId,
          to: [ACTIVITY_STREAM_PUBLIC, EXTERNAL_ACTOR1],
          cc: [ACTOR1_FOLLOWER_URL]
        }
      })
    ).resolves.toBeUndefined()

    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        id: getDeliveryJobId('delete-job-inline', EXTERNAL_ACTOR1_INBOX),
        data: expect.objectContaining({ inbox: EXTERNAL_ACTOR1_INBOX })
      })
    )
  })
})
