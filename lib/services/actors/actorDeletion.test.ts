import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import {
  publishActorDeletion,
  startActorDeletionSweep,
  sweepScheduledActorDeletions
} from '@/lib/services/actors/actorDeletion'
import { getQueue } from '@/lib/services/queue'
import { JobMessage, Queue } from '@/lib/services/queue/type'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

const DAY_MS = 24 * 60 * 60 * 1000

const makeQueue = (runsInline: boolean) => {
  const published: JobMessage[] = []
  const queue: Queue = {
    runsInline,
    publish: vi.fn(async (message: JobMessage) => {
      published.push(message)
    }),
    handle: vi.fn()
  }
  vi.mocked(getQueue).mockReturnValue(
    queue as unknown as ReturnType<typeof getQueue>
  )
  return { queue, published }
}

describe('publishActorDeletion', () => {
  it('publishes an immediate deletion without a delay', async () => {
    const { published } = makeQueue(false)

    await publishActorDeletion({
      actorId: 'https://llun.test/users/gone',
      scheduledAt: null
    })

    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId: 'https://llun.test/users/gone' }
    })
    expect(published[0].delaySeconds).toBeUndefined()
  })

  it('publishes a delayed deletion with the delay and the schedule it was queued for', async () => {
    const { published } = makeQueue(false)
    const scheduledAt = new Date(Date.now() + 3 * DAY_MS)

    await publishActorDeletion({
      actorId: 'https://llun.test/users/later',
      scheduledAt
    })

    expect(published).toHaveLength(1)
    expect(published[0].name).toBe(DELETE_ACTOR_JOB_NAME)
    expect(published[0].data).toEqual({
      actorId: 'https://llun.test/users/later',
      scheduledAt: scheduledAt.getTime()
    })
    expect(published[0].delaySeconds).toBeGreaterThan(3 * 86400 - 5)
    expect(published[0].delaySeconds).toBeLessThanOrEqual(3 * 86400)
  })

  it('leaves a delayed deletion to the sweep under the in-process queue, which would drop it', async () => {
    const { published } = makeQueue(true)

    await publishActorDeletion({
      actorId: 'https://llun.test/users/later',
      scheduledAt: new Date(Date.now() + DAY_MS)
    })

    expect(published).toEqual([])
  })

  it('does not fail the request when the queue refuses the delayed job', async () => {
    const { queue } = makeQueue(false)
    vi.mocked(queue.publish).mockRejectedValueOnce(new Error('delay too long'))

    await expect(
      publishActorDeletion({
        actorId: 'https://llun.test/users/later',
        scheduledAt: new Date(Date.now() + DAY_MS)
      })
    ).resolves.toBeUndefined()
  })
})

describe('sweepScheduledActorDeletions', () => {
  const database = getTestSQLDatabase()

  const createActorScheduledAt = async (
    username: string,
    scheduledAt: Date | null
  ) => {
    await database.createAccount({
      email: `${username}@llun.test`,
      username,
      passwordHash: 'hash',
      domain: 'llun.test',
      privateKey: `privateKey-${username}`,
      publicKey: `publicKey-${username}`
    })
    const actorId = `https://llun.test/users/${username}`
    await database.scheduleActorDeletion({ actorId, scheduledAt })
    return actorId
  }

  beforeAll(async () => {
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('publishes a job only for scheduled deletions that have come due', async () => {
    const { published } = makeQueue(true)
    const due = await createActorScheduledAt(
      'sweep-due',
      new Date(Date.now() - 1000)
    )
    const notYet = await createActorScheduledAt(
      'sweep-future',
      new Date(Date.now() + DAY_MS)
    )
    const immediate = await createActorScheduledAt('sweep-immediate', null)

    const count = await sweepScheduledActorDeletions(database)

    const actorIds = published.map((message) => message.data)
    expect(actorIds).toContainEqual({ actorId: due })
    expect(actorIds).not.toContainEqual({ actorId: notYet })
    expect(actorIds).not.toContainEqual({ actorId: immediate })
    expect(count).toBe(published.length)
    expect(published.every((m) => m.name === DELETE_ACTOR_JOB_NAME)).toBe(true)
  })

  it('does not republish a deletion whose own delayed job is still in flight', async () => {
    const { published } = makeQueue(false)
    const justDue = await createActorScheduledAt(
      'sweep-just-due',
      new Date(Date.now() - 1000)
    )
    const overdue = await createActorScheduledAt(
      'sweep-overdue',
      new Date(Date.now() - 60 * 60 * 1000)
    )

    await sweepScheduledActorDeletions(database)

    const actorIds = published.map((message) => message.data)
    expect(actorIds).not.toContainEqual({ actorId: justDue })
    expect(actorIds).toContainEqual({ actorId: overdue })
  })

  it('keeps sweeping when one job fails to publish', async () => {
    const { queue, published } = makeQueue(true)
    await createActorScheduledAt(
      'sweep-fail-a',
      new Date(Date.now() - 2 * DAY_MS)
    )
    await createActorScheduledAt(
      'sweep-fail-b',
      new Date(Date.now() - 2 * DAY_MS)
    )
    vi.mocked(queue.publish).mockRejectedValueOnce(new Error('queue down'))

    const count = await sweepScheduledActorDeletions(database)

    expect(count).toBeGreaterThanOrEqual(1)
    expect(published.length).toBe(count)
  })
})

describe('startActorDeletionSweep', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sweeps on a timer and stops when asked', async () => {
    vi.useFakeTimers()
    const { published } = makeQueue(true)
    const getActorsScheduledForDeletion = vi
      .fn()
      .mockResolvedValue([{ id: 'https://llun.test/users/timed' }])
    const database = {
      getActorsScheduledForDeletion
    } as unknown as Parameters<typeof startActorDeletionSweep>[0]

    const sweep = startActorDeletionSweep(database, { intervalMs: 1000 })
    expect(getActorsScheduledForDeletion).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(getActorsScheduledForDeletion).toHaveBeenCalledTimes(1)
    expect(published).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(getActorsScheduledForDeletion).toHaveBeenCalledTimes(2)

    sweep.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(getActorsScheduledForDeletion).toHaveBeenCalledTimes(2)
  })

  it('survives a failing sweep and tries again on the next tick', async () => {
    vi.useFakeTimers()
    makeQueue(true)
    const getActorsScheduledForDeletion = vi
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValue([])
    const database = {
      getActorsScheduledForDeletion
    } as unknown as Parameters<typeof startActorDeletionSweep>[0]

    const sweep = startActorDeletionSweep(database, { intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(2000)

    expect(getActorsScheduledForDeletion).toHaveBeenCalledTimes(2)
    sweep.stop()
  })
})
