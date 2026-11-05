import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  DELIVER_ACTIVITY_JOB_NAME,
  SEND_FEATURED_STATUS_JOB_NAME
} from '@/lib/jobs/names'
import { sendFeaturedStatusJob } from '@/lib/jobs/sendFeaturedStatusJob'
import { getDeliveryJobId } from '@/lib/jobs/sendNoteJob'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { AddAction, RemoveAction } from '@/lib/types/activitypub/activities'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'

const publish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

const mockQueue = (runsInline: boolean) =>
  vi.mocked(getQueue).mockReturnValue({
    runsInline,
    publish,
    handle: vi.fn()
  } as unknown as ReturnType<typeof getQueue>)

describe('sendFeaturedStatusJob', () => {
  const { database, prepare } = createTestDatabase()
  const statusId = `${ACTOR1_ID}/statuses/post-1`

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    await database.unpinStatus({ actorId: ACTOR1_ID, statusId })
    publish.mockReset()
    publish.mockResolvedValue(undefined)
    mockQueue(false)
  })

  it('delivers an Add activity for the featured collection to each follower inbox', async () => {
    await database.pinStatus({ actorId: ACTOR1_ID, statusId })
    await sendFeaturedStatusJob(database, {
      id: 'send-featured-add-1',
      name: SEND_FEATURED_STATUS_JOB_NAME,
      data: {
        actorId: ACTOR1_ID,
        statusId,
        action: AddAction,
        eventId: 'pin-event-1'
      }
    })

    const deliveries = publish.mock.calls.map(([message]) => message)
    expect(deliveries.map((message) => message.data.inbox)).toContain(
      'https://somewhere.test/inbox'
    )
    const delivery = deliveries.find(
      (message) => message.data.inbox === 'https://somewhere.test/inbox'
    )
    expect(delivery).toEqual({
      id: getDeliveryJobId(
        'send-featured-add-1',
        'https://somewhere.test/inbox'
      ),
      name: DELIVER_ACTIVITY_JOB_NAME,
      data: {
        inbox: 'https://somewhere.test/inbox',
        actorId: ACTOR1_ID,
        activity: {
          '@context': ACTIVITY_STREAM_URL,
          id: `${statusId}#pin/pin-event-1`,
          type: 'Add',
          actor: ACTOR1_ID,
          object: statusId,
          target: `${ACTOR1_ID}/collections/featured`
        }
      }
    })
  })

  it('delivers a Remove activity for the featured collection to each follower inbox', async () => {
    await database.pinStatus({ actorId: ACTOR1_ID, statusId })
    await database.unpinStatus({ actorId: ACTOR1_ID, statusId })
    await sendFeaturedStatusJob(database, {
      id: 'send-featured-remove-1',
      name: SEND_FEATURED_STATUS_JOB_NAME,
      data: {
        actorId: ACTOR1_ID,
        statusId,
        action: RemoveAction,
        eventId: 'unpin-event-1'
      }
    })

    const deliveries = publish.mock.calls.map(([message]) => message)
    const delivery = deliveries.find(
      (message) => message.data.inbox === 'https://somewhere.test/inbox'
    )
    expect(delivery).toEqual({
      id: getDeliveryJobId(
        'send-featured-remove-1',
        'https://somewhere.test/inbox'
      ),
      name: DELIVER_ACTIVITY_JOB_NAME,
      data: {
        inbox: 'https://somewhere.test/inbox',
        actorId: ACTOR1_ID,
        activity: {
          '@context': ACTIVITY_STREAM_URL,
          id: `${statusId}#unpin/unpin-event-1`,
          type: 'Remove',
          actor: ACTOR1_ID,
          object: statusId,
          target: `${ACTOR1_ID}/collections/featured`
        }
      }
    })
  })

  it.each([AddAction, RemoveAction])(
    'drops a superseded %s event when the current pin state no longer matches',
    async (action) => {
      await database.pinStatus({ actorId: ACTOR1_ID, statusId })
      if (action === AddAction) {
        await database.unpinStatus({ actorId: ACTOR1_ID, statusId })
      }

      await sendFeaturedStatusJob(database, {
        id: `send-featured-superseded-${action}`,
        name: SEND_FEATURED_STATUS_JOB_NAME,
        data: {
          actorId: ACTOR1_ID,
          statusId,
          action,
          eventId: 'superseded-event-1'
        }
      })

      expect(publish).not.toHaveBeenCalled()
    }
  )

  it('does nothing when the actor is missing or remote', async () => {
    const getActorSpy = vi.spyOn(database, 'getActorFromId')
    try {
      await sendFeaturedStatusJob(database, {
        id: 'send-featured-missing',
        name: SEND_FEATURED_STATUS_JOB_NAME,
        data: {
          actorId: 'https://llun.test/users/does-not-exist',
          statusId,
          action: AddAction,
          eventId: 'pin-event-1'
        }
      })
      await sendFeaturedStatusJob(database, {
        id: 'send-featured-remote',
        name: SEND_FEATURED_STATUS_JOB_NAME,
        data: {
          actorId: EXTERNAL_ACTOR1,
          statusId: `${EXTERNAL_ACTOR1}/statuses/1`,
          action: AddAction,
          eventId: 'pin-event-1'
        }
      })

      expect(getActorSpy).toHaveBeenCalledTimes(2)
      expect(publish).not.toHaveBeenCalled()
    } finally {
      getActorSpy.mockRestore()
    }
  })

  it('sends nothing for a pinned post that is not publicly readable or is gone', async () => {
    const stored = await database.getStatus({ statusId, withReplies: false })
    if (!stored) throw new Error('seeded status is missing')
    const getStatusSpy = vi
      .spyOn(database, 'getStatus')
      .mockResolvedValueOnce({
        ...stored,
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })
      .mockResolvedValueOnce(null)
    try {
      for (const action of [AddAction, RemoveAction]) {
        await sendFeaturedStatusJob(database, {
          id: `send-featured-private-${action}`,
          name: SEND_FEATURED_STATUS_JOB_NAME,
          data: {
            actorId: ACTOR1_ID,
            statusId,
            action,
            eventId: 'private-event-1'
          }
        })
      }

      expect(getStatusSpy).toHaveBeenCalledTimes(2)
      expect(publish).not.toHaveBeenCalled()
    } finally {
      getStatusSpy.mockRestore()
    }
  })

  it('retries the fan-out when a real queue refuses a delivery', async () => {
    await database.pinStatus({ actorId: ACTOR1_ID, statusId })
    publish.mockRejectedValue(new Error('queue unavailable'))

    await expect(
      sendFeaturedStatusJob(database, {
        id: 'send-featured-retry',
        name: SEND_FEATURED_STATUS_JOB_NAME,
        data: {
          actorId: ACTOR1_ID,
          statusId,
          action: AddAction,
          eventId: 'pin-event-1'
        }
      })
    ).rejects.toThrow('queue unavailable')
  })

  it('keeps going when an inline delivery fails', async () => {
    await database.pinStatus({ actorId: ACTOR1_ID, statusId })
    mockQueue(true)
    publish.mockRejectedValue(new Error('inbox down'))

    await expect(
      sendFeaturedStatusJob(database, {
        id: 'send-featured-inline',
        name: SEND_FEATURED_STATUS_JOB_NAME,
        data: {
          actorId: ACTOR1_ID,
          statusId,
          action: AddAction,
          eventId: 'pin-event-1'
        }
      })
    ).resolves.toBeUndefined()
    expect(publish).toHaveBeenCalled()
  })
})
