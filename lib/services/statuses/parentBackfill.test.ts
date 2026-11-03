import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { FETCH_REMOTE_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import type { Queue } from '@/lib/services/queue/type'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { createDeferred } from '@/lib/testing/deferred'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import {
  PARENT_FETCH_COOLDOWN_MS,
  getParentFetchJobId,
  queueMissingParentFetch,
  queueThreadGapBackfill,
  resetParentBackfillStateForTesting
} from './parentBackfill'

const mockQueue = {
  runsInline: false,
  publish: vi.fn<Queue['publish']>(),
  handle: vi.fn()
}

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

const REMOTE = 'https://remote.example/users/alice'

describe('queueMissingParentFetch', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await database.createDomainBlock({
      domain: 'blocked.example',
      severity: 'suspend'
    })
    await database.createNote({
      id: `${REMOTE}/statuses/stored`,
      url: `${REMOTE}/@stored`,
      actorId: REMOTE,
      text: 'stored',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    resetParentBackfillStateForTesting()
    mockQueue.runsInline = false
    mockQueue.publish.mockReset()
    mockQueue.publish.mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReset()
    vi.mocked(getQueue).mockReturnValue(
      mockQueue as unknown as ReturnType<typeof getQueue>
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('queues one ancestors-only fetch for a burst of replies to a missing parent', async () => {
    const parent = `${REMOTE}/statuses/missing`
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        queueMissingParentFetch({ database, inReplyTo: parent })
      )
    )

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(mockQueue.publish).toHaveBeenCalledTimes(1)
    expect(mockQueue.publish).toHaveBeenCalledWith({
      id: getParentFetchJobId(parent, Date.now()),
      name: FETCH_REMOTE_STATUS_JOB_NAME,
      data: { statusId: parent, ancestorsOnly: true, firstPageOnly: false }
    })
  })

  it.each([
    {
      description: 'a parent stored by id',
      reply: `${REMOTE}/statuses/stored`
    },
    { description: 'a parent stored by url', reply: `${REMOTE}/@stored` },
    {
      description: 'a parent on a blocked domain',
      reply: 'https://blocked.example/users/bob/statuses/1'
    },
    {
      description: 'a parent on this instance',
      reply: `https://${TEST_DOMAIN}/users/test1/statuses/gone`
    },
    { description: 'a non-https reference', reply: 'http://remote.example/1' },
    { description: 'no reference', reply: '' }
  ])('queues nothing for $description', async ({ reply }) => {
    expect(await queueMissingParentFetch({ database, inReplyTo: reply })).toBe(
      false
    )
    expect(mockQueue.publish).not.toHaveBeenCalled()
  })

  // `federation.allowActorDomains` can list remote servers, so it must not
  // count as "this server" here: a parent there is still fetched.
  it('queues a parent on a remote domain the actor allow-list names', async () => {
    await database.setServerSettings([
      { key: 'federation.allowActorDomains', value: ['listed.example'] }
    ])
    invalidateServerSettingsCache(database)
    try {
      expect(
        await queueMissingParentFetch({
          database,
          inReplyTo: 'https://listed.example/users/bob/statuses/1'
        })
      ).toBe(true)
      expect(mockQueue.publish).toHaveBeenCalledTimes(1)
    } finally {
      await database.setServerSettings([
        { key: 'federation.allowActorDomains', value: [] }
      ])
      invalidateServerSettingsCache(database)
    }
  })

  it('queues the parent again, under a new job id, once the cooldown passes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.UTC(2026, 10, 1)
    vi.setSystemTime(start)
    const parent = `${REMOTE}/statuses/retry`

    expect(await queueMissingParentFetch({ database, inReplyTo: parent })).toBe(
      true
    )
    vi.setSystemTime(start + PARENT_FETCH_COOLDOWN_MS - 1)
    expect(await queueMissingParentFetch({ database, inReplyTo: parent })).toBe(
      false
    )
    vi.setSystemTime(start + PARENT_FETCH_COOLDOWN_MS)
    expect(await queueMissingParentFetch({ database, inReplyTo: parent })).toBe(
      true
    )

    const ids = mockQueue.publish.mock.calls.map(([message]) => message.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('lets the next reply retry when a queue refuses the job', async () => {
    const parent = `${REMOTE}/statuses/refused`
    mockQueue.publish.mockRejectedValueOnce(new Error('queue down'))

    expect(await queueMissingParentFetch({ database, inReplyTo: parent })).toBe(
      false
    )
    expect(await queueMissingParentFetch({ database, inReplyTo: parent })).toBe(
      true
    )
    expect(mockQueue.publish).toHaveBeenCalledTimes(2)
  })

  it('does not wait for an inline run when detached', async () => {
    mockQueue.runsInline = true
    const run = createDeferred<void>()
    mockQueue.publish.mockReturnValue(run.promise)

    expect(
      await queueMissingParentFetch({
        database,
        inReplyTo: `${REMOTE}/statuses/inline`,
        detachInline: true
      })
    ).toBe(true)
    expect(mockQueue.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ firstPageOnly: true })
      })
    )
    run.resolve()
  })

  it('queues the parent a context walk stopped at, without waiting', async () => {
    mockQueue.runsInline = true
    const run = createDeferred<void>()
    mockQueue.publish.mockReturnValue(run.promise)

    expect(
      await queueThreadGapBackfill({
        database,
        missingParentId: `${REMOTE}/statuses/above-root`
      })
    ).toBe(true)
    expect(mockQueue.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statusId: `${REMOTE}/statuses/above-root`
        })
      })
    )
    run.resolve()
  })

  it('queues nothing when the context walk reached the root', async () => {
    expect(
      await queueThreadGapBackfill({ database, missingParentId: '' })
    ).toBe(false)
    expect(mockQueue.publish).not.toHaveBeenCalled()
  })
})
