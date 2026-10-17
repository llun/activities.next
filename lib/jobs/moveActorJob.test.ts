import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { moveActorJob } from '@/lib/jobs/moveActorJob'
import { getMoveFollowerJobId } from '@/lib/jobs/moveFollowerJob'
import { MOVE_ACTOR_JOB_NAME, MOVE_FOLLOWER_JOB_NAME } from '@/lib/jobs/names'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { FollowStatus } from '@/lib/types/domain/follow'

const mockPublish = vi.hoisted(() => vi.fn())

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))
vi.mock('@/lib/activities/getActorPerson', () => ({ getActorPerson: vi.fn() }))
vi.mock('@/lib/actions/utils', () => ({ recordActorIfNeeded: vi.fn() }))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(undefined)
}))

const ORIGIN = EXTERNAL_ACTOR1
const TARGET = 'https://newhome.test/users/test1'
const DAY = 24 * 60 * 60 * 1000

const message = (
  overrides: Record<string, unknown> = {},
  sender = ORIGIN,
  id = 'inbox-move-1'
) => ({
  id,
  name: MOVE_ACTOR_JOB_NAME,
  data: { actor: ORIGIN, object: ORIGIN, target: TARGET, ...overrides },
  verifiedSenderActorId: sender
})

const targetPerson = (
  alsoKnownAs: string[] = [ORIGIN],
  movedTo?: string,
  id = TARGET
) =>
  ({
    id,
    alsoKnownAs,
    ...(movedTo ? { movedTo } : {})
  }) as Awaited<ReturnType<typeof getActorPerson>>

describe('moveActorJob', () => {
  let database: Database

  beforeEach(async () => {
    const created = createTestDatabase()
    database = created.database
    await created.prepare()
    await database.migrate()
    await seedDatabase(database)

    mockPublish.mockReset()
    vi.mocked(getActorPerson).mockReset().mockResolvedValue(targetPerson())
    // Records the target the way the real helper does once its document has
    // been fetched, so the job has a stored row.
    vi.mocked(recordActorIfNeeded)
      .mockReset()
      .mockImplementation(async ({ actorId, forceRefresh }) => {
        // The target must be re-read from its own server, never from a copy
        // stored earlier.
        if (actorId === TARGET) expect(forceRefresh).toBe(true)
        const existing = await database.getActorFromId({ id: actorId })
        if (existing) return existing
        const url = new URL(actorId)
        return (
          (await database.createActor({
            actorId,
            username: 'test1',
            domain: url.host,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: `${url.origin}/inbox`,
            followersUrl: `${actorId}/followers`,
            publicKey: 'publicKey',
            createdAt: Date.now()
          })) ?? undefined
        )
      })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await database.destroy()
  })

  const accepted = (actorId: string, targetActorId: string) =>
    database.getAcceptedOrRequestedFollow({ actorId, targetActorId })

  const claim = async () =>
    (await database.getActorSettings({ actorId: ORIGIN }))?.moveProcessing

  const publishedFollowerJobs = () =>
    mockPublish.mock.calls
      .map(([published]) => published)
      .filter(({ name }) => name === MOVE_FOLLOWER_JOB_NAME)

  const expectNothingMoved = async () => {
    expect(publishedFollowerJobs()).toEqual([])
    expect(
      (await database.getActorFromId({ id: ORIGIN }))?.movedTo
    ).toBeUndefined()
    expect((await accepted(ACTOR1_ID, ORIGIN))?.status).toBe(
      FollowStatus.enum.Accepted
    )
  }

  it('records movedTo and queues one job per accepted local follower', async () => {
    const first = await accepted(ACTOR1_ID, ORIGIN)
    const second = await database.createFollow({
      actorId: ACTOR2_ID,
      targetActorId: ORIGIN,
      status: FollowStatus.enum.Accepted,
      inbox: `${ACTOR2_ID}/inbox`,
      sharedInbox: 'https://llun.test/inbox'
    })

    await moveActorJob(database, message())

    expect((await database.getActorFromId({ id: ORIGIN }))?.movedTo).toBe(
      TARGET
    )
    expect(publishedFollowerJobs()).toHaveLength(2)
    expect(publishedFollowerJobs()).toEqual(
      expect.arrayContaining([
        {
          id: getMoveFollowerJobId(first?.id as string, TARGET),
          name: MOVE_FOLLOWER_JOB_NAME,
          data: { followId: first?.id, targetActorId: TARGET }
        },
        {
          id: getMoveFollowerJobId(second.id, TARGET),
          name: MOVE_FOLLOWER_JOB_NAME,
          data: { followId: second.id, targetActorId: TARGET }
        }
      ])
    )
    // The job only fans out; the followers are rewired by their own jobs.
    expect((await accepted(ACTOR1_ID, ORIGIN))?.status).toBe(
      FollowStatus.enum.Accepted
    )
    expect(await accepted(ACTOR1_ID, TARGET)).toBeNull()
  })

  it('refreshes the target from its server', async () => {
    await moveActorJob(database, message())

    expect(recordActorIfNeeded).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: TARGET, forceRefresh: true })
    )
  })

  it('stores the cooldown in the origin actor settings', async () => {
    const before = Date.now()
    await moveActorJob(database, message())

    const stored = await claim()
    expect(stored?.activityId).toBe('inbox-move-1')
    expect(stored?.target).toBe(TARGET)
    expect(stored?.at).toBeGreaterThanOrEqual(before)
  })

  it('queues nothing when the same Move is replayed after a completed fan-out', async () => {
    await moveActorJob(database, message())
    expect(publishedFollowerJobs()).toHaveLength(1)
    expect((await claim())?.queued).toBe(true)
    mockPublish.mockClear()
    vi.mocked(getActorPerson).mockClear()

    await moveActorJob(database, message())

    expect(mockPublish).not.toHaveBeenCalled()
    expect(getActorPerson).not.toHaveBeenCalled()
    expect((await claim())?.activityId).toBe('inbox-move-1')
  })

  it('does not mark the claim queued while a follower could not be queued', async () => {
    mockPublish.mockRejectedValueOnce(new Error('queue down'))
    await expect(moveActorJob(database, message())).rejects.toThrow(
      'could not be queued'
    )

    const stored = await claim()
    expect(stored?.verified).toBe(true)
    expect(stored?.queued).toBeUndefined()
  })

  it('does not abandon followers when a retry finds movedTo already set', async () => {
    mockPublish.mockRejectedValueOnce(new Error('queue down'))

    await expect(moveActorJob(database, message())).rejects.toThrow(
      'could not be queued'
    )
    expect((await database.getActorFromId({ id: ORIGIN }))?.movedTo).toBe(
      TARGET
    )
    // The claim is kept: this activity may retry, others may not.
    expect((await claim())?.activityId).toBe('inbox-move-1')
    mockPublish.mockClear()

    await moveActorJob(database, message())

    expect(publishedFollowerJobs()).toHaveLength(1)
  })

  it('queues followers on retry without re-verifying a Move it already verified', async () => {
    mockPublish.mockRejectedValueOnce(new Error('queue down'))
    await expect(moveActorJob(database, message())).rejects.toThrow(
      'could not be queued'
    )
    mockPublish.mockClear()
    // The target is unreachable on the retry.
    vi.mocked(getActorPerson).mockReset().mockResolvedValue(null)

    await moveActorJob(database, message())

    expect(getActorPerson).not.toHaveBeenCalled()
    expect(publishedFollowerJobs()).toHaveLength(1)
    expect((await database.getActorFromId({ id: ORIGIN }))?.movedTo).toBe(
      TARGET
    )
    expect((await claim())?.verified).toBe(true)
    expect((await claim())?.queued).toBe(true)
  })

  it('verifies again when the origin movedTo was cleared before the retry', async () => {
    mockPublish.mockRejectedValueOnce(new Error('queue down'))
    await expect(moveActorJob(database, message())).rejects.toThrow(
      'could not be queued'
    )
    await database.updateActor({ actorId: ORIGIN, movedTo: null })
    mockPublish.mockClear()
    vi.mocked(getActorPerson).mockClear()

    await moveActorJob(database, message())

    expect(getActorPerson).toHaveBeenCalled()
    expect(publishedFollowerJobs()).toHaveLength(1)
    expect((await database.getActorFromId({ id: ORIGIN }))?.movedTo).toBe(
      TARGET
    )
  })

  it('refuses a different Move of the same origin within 7 days', async () => {
    await moveActorJob(database, message())
    mockPublish.mockClear()
    vi.mocked(getActorPerson).mockClear()

    await moveActorJob(
      database,
      message({ target: 'https://other.test/users/x' }, ORIGIN, 'inbox-move-2')
    )

    expect(getActorPerson).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
    expect((await claim())?.activityId).toBe('inbox-move-1')
    expect((await database.getActorFromId({ id: ORIGIN }))?.movedTo).toBe(
      TARGET
    )
  })

  it('keeps a verified claim when a replay of the same Move fails verification', async () => {
    await moveActorJob(database, message())
    expect((await claim())?.verified).toBe(true)
    mockPublish.mockClear()
    vi.mocked(getActorPerson).mockResolvedValue(targetPerson([ACTOR2_ID]))

    await moveActorJob(database, message())

    // The replay is not verified again and queues nothing.
    expect(mockPublish).not.toHaveBeenCalled()
    expect((await claim())?.activityId).toBe('inbox-move-1')
    expect((await claim())?.verified).toBe(true)

    // A different Move inside the 7 days is still refused.
    mockPublish.mockClear()
    vi.mocked(getActorPerson).mockResolvedValue(
      targetPerson([ORIGIN], undefined, 'https://other.test/users/x')
    )
    await moveActorJob(
      database,
      message({ target: 'https://other.test/users/x' }, ORIGIN, 'inbox-move-2')
    )

    expect(mockPublish).not.toHaveBeenCalled()
    expect((await claim())?.activityId).toBe('inbox-move-1')
    expect((await database.getActorFromId({ id: ORIGIN }))?.movedTo).toBe(
      TARGET
    )
  })

  it('accepts another Move once the 7 days have passed', async () => {
    const now = Date.now()
    await moveActorJob(database, message())
    mockPublish.mockClear()
    vi.spyOn(Date, 'now').mockReturnValue(now + 7 * DAY + 1000)

    await moveActorJob(database, message({}, ORIGIN, 'inbox-move-2'))

    expect(publishedFollowerJobs()).toHaveLength(1)
    expect((await claim())?.activityId).toBe('inbox-move-2')
  })

  it('verifies the same activity again after the 7 days', async () => {
    const now = Date.now()
    await moveActorJob(database, message())
    expect((await claim())?.queued).toBe(true)
    mockPublish.mockClear()
    vi.spyOn(Date, 'now').mockReturnValue(now + 7 * DAY + 1000)
    vi.mocked(getActorPerson).mockReset().mockResolvedValue(null)

    await moveActorJob(database, message())

    // The expired claim was replaced whole, so neither flag carried over.
    expect(getActorPerson).toHaveBeenCalled()
    expect(publishedFollowerJobs()).toEqual([])
    expect(await claim()).toBeUndefined()
  })

  it('still refuses a different Move just inside the 7 days', async () => {
    const now = Date.now()
    await moveActorJob(database, message())
    mockPublish.mockClear()
    vi.spyOn(Date, 'now').mockReturnValue(now + 7 * DAY - 60_000)

    await moveActorJob(database, message({}, ORIGIN, 'inbox-move-2'))

    expect(mockPublish).not.toHaveBeenCalled()
  })

  describe('releases the cooldown when verification fails', () => {
    const failures: {
      case: string
      arrange: (db: () => Database) => void | Promise<void>
    }[] = [
      {
        case: 'the target does not list the origin',
        arrange: () => {
          vi.mocked(getActorPerson).mockResolvedValue(targetPerson([ACTOR2_ID]))
        }
      },
      {
        case: 'the target has no aliases',
        arrange: () => {
          vi.mocked(getActorPerson).mockResolvedValue(targetPerson([]))
        }
      },
      {
        case: 'the target cannot be fetched',
        arrange: () => {
          vi.mocked(getActorPerson).mockResolvedValue(null)
        }
      },
      {
        case: 'the fetched document is not the target',
        arrange: () => {
          vi.mocked(getActorPerson).mockResolvedValue(
            targetPerson([ORIGIN], undefined, 'https://evil.test/users/x')
          )
        }
      },
      {
        case: 'the target is suspended',
        arrange: (db) => {
          vi.spyOn(db(), 'getModerationStatesForActors').mockImplementation(
            async ({ actorIds }) =>
              new Map(
                actorIds.some((id) => id === TARGET)
                  ? [
                      [
                        TARGET,
                        { suspendedAt: 1, silencedAt: null, sensitizedAt: null }
                      ]
                    ]
                  : []
              )
          )
        }
      },
      {
        case: 'the target is being deleted',
        arrange: () => {
          const record = vi.mocked(recordActorIfNeeded).getMockImplementation()
          vi.mocked(recordActorIfNeeded).mockImplementation(async (params) => {
            const actor = await record?.(params)
            return actor && params.actorId === TARGET
              ? { ...actor, deletionStatus: 'scheduled' as const }
              : actor
          })
        }
      }
    ]

    it.each(failures)('$case', async ({ arrange }) => {
      await arrange(() => database)

      await moveActorJob(database, message())

      await expectNothingMoved()
      expect(await claim()).toBeUndefined()

      // A correct Move is not locked out by the failed one.
      vi.restoreAllMocks()
      vi.mocked(getActorPerson).mockResolvedValue(targetPerson())
      vi.mocked(recordActorIfNeeded).mockImplementation(
        async ({ actorId }) =>
          (await database.getActorFromId({ id: actorId })) ??
          (await database.createActor({
            actorId,
            username: 'test1',
            domain: new URL(actorId).host,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: `${new URL(actorId).origin}/inbox`,
            followersUrl: `${actorId}/followers`,
            publicKey: 'publicKey',
            createdAt: Date.now()
          })) ??
          undefined
      )
      await moveActorJob(database, message({}, ORIGIN, 'inbox-move-2'))
      expect(publishedFollowerJobs()).toHaveLength(1)
    })
  })

  it('refuses a suspended target before recording movedTo', async () => {
    vi.spyOn(database, 'getModerationStatesForActors').mockImplementation(
      async ({ actorIds }) =>
        new Map(
          actorIds.some((id) => id === TARGET)
            ? [
                [
                  TARGET,
                  { suspendedAt: 1, silencedAt: null, sensitizedAt: null }
                ]
              ]
            : []
        )
    )

    await moveActorJob(database, message())

    await expectNothingMoved()
  })

  it('refuses a deleted target before recording movedTo', async () => {
    vi.mocked(recordActorIfNeeded).mockImplementation(async ({ actorId }) => {
      const actor = await database.createActor({
        actorId,
        username: 'test1',
        domain: new URL(actorId).host,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `${new URL(actorId).origin}/inbox`,
        followersUrl: `${actorId}/followers`,
        publicKey: 'publicKey',
        createdAt: Date.now()
      })
      return actor ? { ...actor, deletionStatus: 'deleting' } : undefined
    })

    await moveActorJob(database, message())

    await expectNothingMoved()
  })

  it('refuses a target whose fetched document has another id', async () => {
    vi.mocked(getActorPerson).mockResolvedValue(
      targetPerson([ORIGIN], undefined, 'https://evil.test/users/x')
    )

    await moveActorJob(database, message())

    await expectNothingMoved()
    expect(recordActorIfNeeded).not.toHaveBeenCalledWith(
      expect.objectContaining({ actorId: TARGET })
    )
  })

  it.each([
    { case: 'origin', domain: 'llun.dev' },
    { case: 'target', domain: 'newhome.test' }
  ])('refuses a Move when the $case domain is blocked', async ({ domain }) => {
    await database.createDomainBlock({ domain, severity: 'suspend' })

    await moveActorJob(database, message())

    expect(getActorPerson).not.toHaveBeenCalled()
    await expectNothingMoved()
    expect(await claim()).toBeUndefined()
  })

  it('records movedTo but rewires nobody when the target has itself moved', async () => {
    vi.mocked(getActorPerson).mockResolvedValue(
      targetPerson([ORIGIN], 'https://elsewhere.test/users/test1')
    )

    await moveActorJob(database, message())

    expect((await database.getActorFromId({ id: ORIGIN }))?.movedTo).toBe(
      TARGET
    )
    expect(publishedFollowerJobs()).toEqual([])
    expect((await claim())?.activityId).toBe('inbox-move-1')
  })

  it('refuses a local target', async () => {
    await database.updateActor({ actorId: ACTOR2_ID, alsoKnownAs: [ORIGIN] })

    await moveActorJob(database, message({ target: ACTOR2_ID }))

    expect(getActorPerson).not.toHaveBeenCalled()
    await expectNothingMoved()
    expect(await claim()).toBeUndefined()
  })

  it.each([
    {
      case: 'the signer is not the origin',
      input: message({}, 'https://other.test/users/mallory')
    },
    {
      case: 'the object is not the origin',
      input: message({ object: ACTOR2_ID })
    },
    { case: 'the target is the origin', input: message({ target: ORIGIN }) },
    { case: 'the data is malformed', input: message({ target: undefined }) },
    {
      case: 'the origin is local',
      input: message({ actor: ACTOR1_ID, object: ACTOR1_ID }, ACTOR1_ID)
    }
  ])('ignores the move when $case', async ({ input }) => {
    await moveActorJob(database, input)

    expect(getActorPerson).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('ignores the move when the origin is suspended', async () => {
    vi.spyOn(database, 'getModerationStatesForActors').mockResolvedValue(
      new Map([
        [ORIGIN, { suspendedAt: 1, silencedAt: null, sensitizedAt: null }]
      ])
    )

    await moveActorJob(database, message())

    expect(getActorPerson).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
  })
})
