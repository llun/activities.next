import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  DELIVER_ACTIVITY_JOB_NAME,
  SEND_UPDATE_ACTOR_JOB_NAME
} from '@/lib/jobs/names'
import { getDeliveryJobId } from '@/lib/jobs/sendNoteJob'
import { sendUpdateActorJob } from '@/lib/jobs/sendUpdateActorJob'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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

describe('sendUpdateActorJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    publish.mockReset()
    publish.mockResolvedValue(undefined)
    mockQueue(false)
  })

  it('delivers an Update of the actor profile to each follower inbox', async () => {
    await sendUpdateActorJob(database, {
      id: 'send-update-actor-1',
      name: SEND_UPDATE_ACTOR_JOB_NAME,
      data: { actorId: ACTOR1_ID, updatedAt: 1700000000000 }
    })

    const deliveries = publish.mock.calls.map(([message]) => message)
    expect(deliveries.map((message) => message.data.inbox)).toContain(
      'https://somewhere.test/inbox'
    )
    const delivery = deliveries.find(
      (message) => message.data.inbox === 'https://somewhere.test/inbox'
    )
    expect(delivery).toMatchObject({
      id: getDeliveryJobId(
        'send-update-actor-1',
        'https://somewhere.test/inbox'
      ),
      name: DELIVER_ACTIVITY_JOB_NAME,
      data: {
        actorId: ACTOR1_ID,
        activity: {
          id: `${ACTOR1_ID}#updates/1700000000000`,
          type: 'Update',
          actor: ACTOR1_ID,
          to: [ACTIVITY_STREAM_PUBLIC],
          object: { id: ACTOR1_ID, type: 'Person' }
        }
      }
    })
    expect(delivery.data.activity['@context']).toContain(
      'https://www.w3.org/ns/activitystreams'
    )
    expect(delivery.data.activity.object).not.toHaveProperty('@context')
  })

  it('does not announce a remote actor', async () => {
    await sendUpdateActorJob(database, {
      id: 'send-update-actor-remote',
      name: SEND_UPDATE_ACTOR_JOB_NAME,
      data: { actorId: EXTERNAL_ACTOR1, updatedAt: 1700000000000 }
    })

    expect(publish).not.toHaveBeenCalled()
  })

  it('retries the fan-out when a real queue refuses a delivery', async () => {
    publish.mockRejectedValue(new Error('queue unavailable'))

    await expect(
      sendUpdateActorJob(database, {
        id: 'send-update-actor-retry',
        name: SEND_UPDATE_ACTOR_JOB_NAME,
        data: { actorId: ACTOR1_ID, updatedAt: 1700000000000 }
      })
    ).rejects.toThrow('actor update deliveries')
  })

  it('keeps going when an inline delivery fails', async () => {
    mockQueue(true)
    publish.mockRejectedValue(new Error('inbox down'))

    await expect(
      sendUpdateActorJob(database, {
        id: 'send-update-actor-inline',
        name: SEND_UPDATE_ACTOR_JOB_NAME,
        data: { actorId: ACTOR1_ID, updatedAt: 1700000000000 }
      })
    ).resolves.toBeUndefined()
  })
})
