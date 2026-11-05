import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import { DELIVERY_FAILURE_DAYS_THRESHOLD } from '@/lib/database/domains/deliveryDomains/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  DELIVER_ACTIVITY_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { sendUpdateNoteJob } from '@/lib/jobs/sendUpdateNoteJob'
import { getDeliveryJobId } from '@/lib/services/federation/enqueueDeliveries'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_FOLLOWER_URL, seedActor1 } from '@/lib/stub/seed/actor1'
import {
  EXTERNAL_ACTOR1,
  EXTERNAL_ACTOR1_INBOX
} from '@/lib/stub/seed/external1'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'

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

describe('Send update note job', () => {
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
    if (actor1?.id) {
      await db
        .deleteFrom('follows')
        .where('targetActorId', '=', actor1.id)
        .where('actorId', '!=', 'https://somewhere.test/actors/friend')
        .execute()
    }
  })

  it('builds one Update activity and publishes DELIVER_ACTIVITY per available inbox with dedup ids', async () => {
    if (!actor1) fail('Actor1 is required')

    await database.createFollow({
      actorId: 'https://second.example/users/follower2',
      targetActorId: actor1.id,
      inbox: 'https://second.example/inbox',
      sharedInbox: 'https://second.example/inbox',
      status: FollowStatus.enum.Accepted
    })
    await database.createFollow({
      actorId: 'https://dead.example/users/follower3',
      targetActorId: actor1.id,
      inbox: 'https://dead.example/inbox',
      sharedInbox: 'https://dead.example/inbox',
      status: FollowStatus.enum.Accepted
    })
    for (let day = 1; day <= DELIVERY_FAILURE_DAYS_THRESHOLD; day++) {
      await database.recordDeliveryFailure({
        domain: 'dead.example',
        error: 'HTTP 503',
        now: Date.parse(`2026-11-0${day}T00:00:00.000Z`)
      })
    }

    const status = (await database.getStatus({
      statusId: `${actor1.id}/statuses/post-1`,
      withReplies: false
    })) as Status
    const note = getNoteFromStatus(status)
    if (!note) fail('Note is required')

    await sendUpdateNoteJob(database, {
      id: 'update-job-1',
      name: SEND_UPDATE_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId: status.id
      }
    })

    expect(publish).toHaveBeenCalledTimes(2)
    const calls = publish.mock.calls.map(([msg]) => msg)
    const inboxes = calls.map((msg) => msg.data.inbox).sort()
    expect(inboxes).toEqual([
      'https://second.example/inbox',
      'https://somewhere.test/inbox'
    ])

    for (const msg of calls) {
      expect(msg.id).toBe(getDeliveryJobId('update-job-1', msg.data.inbox))
      expect(msg.name).toBe(DELIVER_ACTIVITY_JOB_NAME)
      expect(msg.data.actorId).toBe(actor1.id)
      expect(msg.data.activity).toMatchObject({
        '@context': NOTE_ACTIVITY_CONTEXT,
        id: expect.stringMatching(new RegExp(`^${status.id}#updates/\\d+$`)),
        type: 'Update',
        actor: actor1.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        object: {
          ...note,
          updated: getISOTimeUTC(status.updatedAt)
        }
      })
    }

    // Activity is built once: every inbox receives the exact same Update id.
    expect(calls[0].data.activity.id).toBe(calls[1].data.activity.id)
  })

  it.each([false, true])(
    'publishes Update(Question), including the closed state when expired=%s',
    async (expired) => {
      if (!actor1) fail('Actor1 is required')
      const statusId = `${actor1.id}/statuses/update-poll-${expired}`
      const endAt = Date.now() + (expired ? -1000 : 60_000)
      const status = await database.createPoll({
        id: statusId,
        url: statusId,
        actorId: actor1.id,
        text: 'Choose a color',
        choices: ['Red', 'Blue'],
        endAt,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [ACTOR1_FOLLOWER_URL]
      })

      await sendUpdateNoteJob(database, {
        id: `poll-update-${expired}`,
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: { actorId: actor1.id, statusId }
      })

      expect(publish).toHaveBeenCalledWith({
        id: getDeliveryJobId(
          `poll-update-${expired}`,
          'https://somewhere.test/inbox'
        ),
        name: DELIVER_ACTIVITY_JOB_NAME,
        data: {
          inbox: 'https://somewhere.test/inbox',
          actorId: actor1.id,
          activity: expect.objectContaining({
            '@context': NOTE_ACTIVITY_CONTEXT,
            type: 'Update',
            object: expect.objectContaining({
              type: 'Question',
              id: statusId,
              updated: getISOTimeUTC(status.updatedAt),
              endTime: getISOTimeUTC(endAt),
              ...(expired ? { closed: getISOTimeUTC(endAt) } : {})
            })
          })
        }
      })

      const published = publish.mock.calls.find(
        ([msg]) => msg.data.inbox === 'https://somewhere.test/inbox'
      )?.[0]
      expect('closed' in published.data.activity.object).toBe(expired)
    }
  )

  it('does nothing if status is not found', async () => {
    if (!actor1) fail('Actor1 is required')

    await sendUpdateNoteJob(database, {
      id: 'job-id',
      name: SEND_UPDATE_NOTE_JOB_NAME,
      data: {
        actorId: actor1.id,
        statusId: 'not-exist-status'
      }
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('does nothing if actor is not found', async () => {
    const status = (await database.getStatus({
      statusId: `${actor1?.id}/statuses/post-1`,
      withReplies: false
    })) as Status

    await sendUpdateNoteJob(database, {
      id: 'job-id',
      name: SEND_UPDATE_NOTE_JOB_NAME,
      data: {
        actorId: 'not-exist-actor',
        statusId: status.id
      }
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('isolates inline delivery errors and retries when a real queue publish fails', async () => {
    if (!actor1) fail('Actor1 is required')
    const statusId = `${actor1.id}/statuses/direct-update-1`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: actor1.id,
      text: 'edited direct note',
      to: [ACTIVITY_STREAM_PUBLIC, EXTERNAL_ACTOR1],
      cc: [ACTOR1_FOLLOWER_URL]
    })

    mockQueue(true)
    publish.mockImplementation(async (msg) => {
      if (msg.data.inbox === 'https://somewhere.test/inbox') {
        throw new Error('inline delivery failed')
      }
    })

    await expect(
      sendUpdateNoteJob(database, {
        id: 'inline-update-1',
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: { actorId: actor1.id, statusId }
      })
    ).resolves.toBeUndefined()
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ inbox: EXTERNAL_ACTOR1_INBOX })
      })
    )

    mockQueue(false)
    publish.mockReset().mockRejectedValue(new Error('queue unavailable'))
    await expect(
      sendUpdateNoteJob(database, {
        id: 'queued-update-1',
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: { actorId: actor1.id, statusId }
      })
    ).rejects.toThrow('Failed to publish 2 delivery jobs')
  })
})
