import { updatePollFromUserInput } from '@/lib/actions/updatePoll'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import type { Actor } from '@/lib/types/domain/actor'
import { StatusPoll } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

const mockPublish = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish, runsInline: false })
}))
vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

describe('updatePollFromUserInput federation', () => {
  const { database, prepare } = createTestDatabase()
  let actor: Actor
  let status: StatusPoll
  let sequence = 0
  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
  })
  afterAll(async () => database.destroy())
  afterEach(() => vi.restoreAllMocks())
  beforeEach(async () => {
    mockPublish.mockReset().mockResolvedValue(undefined)
    const id = `${actor.id}/statuses/edit-poll-${sequence++}`
    status = StatusPoll.parse(
      await database.createPoll({
        id,
        url: id,
        actorId: actor.id,
        text: 'Choose a color',
        choices: ['Red', 'Blue'],
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        endAt: Date.now() + 60_000
      })
    )
  })

  it('queues a revision-specific Update without rescheduling an unchanged endAt', async () => {
    const updated = await updatePollFromUserInput({
      statusId: status.id,
      currentActor: actor,
      sensitive: true,
      database
    })
    expect(mockPublish).toHaveBeenCalledExactlyOnceWith({
      id: getHashFromString(`${status.id}#update/${updated!.updatedAt}`),
      name: SEND_UPDATE_NOTE_JOB_NAME,
      data: { actorId: actor.id, statusId: status.id }
    })
  })

  it('reschedules expiration with an endAt-specific id when expiry changes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now())
    const updated = StatusPoll.parse(
      await updatePollFromUserInput({
        statusId: status.id,
        currentActor: actor,
        database,
        poll: { options: ['Red', 'Blue'], expiresIn: 3600 }
      })
    )
    expect(updated.endAt).not.toBe(status.endAt)
    expect(mockPublish).toHaveBeenCalledTimes(2)
    expect(mockPublish).toHaveBeenLastCalledWith({
      id: getHashFromString(`${status.id}#poll-closed/${updated.endAt}`),
      name: SEND_UPDATE_NOTE_JOB_NAME,
      data: { actorId: actor.id, statusId: status.id },
      delaySeconds: 3601
    })
  })

  it('keeps an edited poll when scheduling its new expiration fails', async () => {
    const error = new Error('Delayed queue unavailable')
    mockPublish.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error)
    const log = vi.spyOn(logger, 'error')
    try {
      const updated = await updatePollFromUserInput({
        statusId: status.id,
        currentActor: actor,
        database,
        poll: { options: ['Red', 'Blue'], expiresIn: 3600 }
      })
      expect(updated).toMatchObject({ id: status.id })
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ statusId: status.id, err: error })
      )
    } finally {
      log.mockRestore()
    }
  })
})
