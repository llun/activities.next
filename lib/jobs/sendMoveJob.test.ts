import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { getMoveFollowerJobId } from '@/lib/jobs/moveFollowerJob'
import { getMoveRelationshipsJobId } from '@/lib/jobs/moveRelationshipsJob'
import {
  DELIVER_ACTIVITY_JOB_NAME,
  MOVE_FOLLOWER_JOB_NAME,
  MOVE_RELATIONSHIPS_JOB_NAME,
  SEND_MOVE_JOB_NAME
} from '@/lib/jobs/names'
import { runSendMove, sendMoveJob } from '@/lib/jobs/sendMoveJob'
import { getDeliveryJobId } from '@/lib/jobs/sendNoteJob'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { FollowStatus } from '@/lib/types/domain/follow'

const mockPublish = vi.hoisted(() => vi.fn())

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish, runsInline: false })
}))

const ORIGIN = ACTOR1_ID
const TARGET = 'https://newhome.test/users/test1'
const MIGRATION = 'migration-1'
const MESSAGE_ID = `${MIGRATION}:start`

describe('sendMoveJob', () => {
  let database: Database

  const message = (data: Record<string, unknown> = {}, id = MESSAGE_ID) => ({
    id,
    name: SEND_MOVE_JOB_NAME,
    data: {
      migrationId: MIGRATION,
      originActorId: ORIGIN,
      targetActorId: TARGET,
      ...data
    }
  })

  const followOrigin = (actorId: string, inbox: string, sharedInbox: string) =>
    database.createFollow({
      actorId,
      targetActorId: ORIGIN,
      status: FollowStatus.enum.Accepted,
      inbox,
      sharedInbox
    })

  const recordMove = (id: string, targetActorId: string) =>
    database.createActorMigration({
      id,
      actorId: ORIGIN,
      targetActorId,
      targetAcct: 'test1@newhome.test',
      kind: 'move',
      followersCount: 0
    })

  const published = () => mockPublish.mock.calls.map(([job]) => job)
  const deliveries = () =>
    published().filter((job) => job.name === DELIVER_ACTIVITY_JOB_NAME)
  const followerJobs = () =>
    published().filter((job) => job.name === MOVE_FOLLOWER_JOB_NAME)

  beforeEach(async () => {
    const created = createTestDatabase()
    database = created.database
    await created.prepare()
    await database.migrate()
    await seedDatabase(database)
    mockPublish.mockReset()
    mockPublish.mockResolvedValue(undefined)

    await database.createActor({
      actorId: TARGET,
      username: 'test1',
      domain: 'newhome.test',
      inboxUrl: `${TARGET}/inbox`,
      sharedInboxUrl: 'https://newhome.test/inbox',
      followersUrl: `${TARGET}/followers`,
      publicKey: 'publicKey',
      createdAt: Date.now()
    })
    await database.updateActor({ actorId: ORIGIN, movedTo: TARGET })
    await recordMove(MIGRATION, TARGET)
    // Seeded remote follower: somewhere.test/inbox (shared). Add a second one
    // behind the same shared inbox, a third one elsewhere, two local ones.
    await followOrigin(
      'https://somewhere.test/actors/friend2',
      'https://somewhere.test/inbox/friend2',
      'https://somewhere.test/inbox'
    )
    await followOrigin(
      'https://other.test/users/a',
      'https://other.test/users/a/inbox',
      'https://other.test/inbox'
    )
    await followOrigin(
      ACTOR2_ID,
      `${ACTOR2_ID}/inbox`,
      'https://llun.test/inbox'
    )
    await followOrigin(
      ACTOR3_ID,
      `${ACTOR3_ID}/inbox`,
      'https://llun.test/inbox'
    )
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('delivers the Move once per remote shared inbox and never to local followers', async () => {
    await sendMoveJob(database, message())

    const sent = deliveries()
    expect(sent.map((job) => job.data.inbox).sort()).toEqual([
      'https://other.test/inbox',
      'https://somewhere.test/inbox'
    ])
    for (const job of sent) {
      expect(job.id).toBe(getDeliveryJobId(MIGRATION, job.data.inbox))
      expect(job.data.actorId).toBe(ORIGIN)
      expect(job.data.activity).toEqual({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${ORIGIN}#moves/${MIGRATION}`,
        type: 'Move',
        actor: ORIGIN,
        object: ORIGIN,
        target: TARGET
      })
    }
    expect(
      sent.some((job) => new URL(String(job.data.inbox)).host === 'llun.test')
    ).toBe(false)
  })

  it('repoints each local follower through MoveFollowerJob, for a remote target', async () => {
    await sendMoveJob(database, message())

    const ids = followerJobs().map((job) => job.data.followId)
    const expected = (
      await Promise.all(
        [ACTOR2_ID, ACTOR3_ID].map((actorId) =>
          database.getAcceptedOrRequestedFollow({
            actorId,
            targetActorId: ORIGIN
          })
        )
      )
    ).map((follow) => follow?.id)
    expect(ids.sort()).toEqual(expected.sort())
    for (const job of followerJobs()) {
      expect(job.id).toBe(getMoveFollowerJobId(job.data.followId, TARGET))
      expect(job.data.targetActorId).toBe(TARGET)
      expect(job.data.migrationId).toBe(MIGRATION)
    }
  })

  it('repoints local followers to a local target', async () => {
    await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })
    await recordMove('migration-2', ACTOR2_ID)
    await sendMoveJob(
      database,
      message({ targetActorId: ACTOR2_ID, migrationId: 'migration-2' })
    )

    expect(followerJobs().map((job) => job.data.targetActorId)).toEqual([
      ACTOR2_ID,
      ACTOR2_ID
    ])
  })

  it('skips follower rewiring when the target has itself moved', async () => {
    await database.updateActor({
      actorId: TARGET,
      movedTo: 'https://third.test/users/test1'
    })
    await sendMoveJob(database, message())

    expect(followerJobs()).toEqual([])
    expect(deliveries()).toHaveLength(2)
  })

  it('publishes the relationship jobs', async () => {
    await database.upsertAccountNote({
      actorId: ACTOR2_ID,
      targetActorId: ORIGIN,
      comment: 'note'
    })
    await sendMoveJob(database, message())

    expect(
      published().filter((job) => job.name === MOVE_RELATIONSHIPS_JOB_NAME)
    ).toEqual([
      {
        id: getMoveRelationshipsJobId(ACTOR2_ID, ORIGIN, TARGET),
        name: MOVE_RELATIONSHIPS_JOB_NAME,
        data: {
          actorId: ACTOR2_ID,
          originActorId: ORIGIN,
          targetActorId: TARGET,
          migrationId: MIGRATION
        }
      }
    ])
  })

  it('republishes the same deterministic ids on a re-run', async () => {
    await sendMoveJob(database, message())
    const first = published().map((job) => job.id)
    mockPublish.mockClear()
    await sendMoveJob(database, message())

    expect(published().map((job) => job.id)).toEqual(first)
  })

  it('continues from the cursor when the time budget is spent', async () => {
    await runSendMove(database, message(), { budgetMs: 0, pageSize: 2 })

    const continuation = published().find(
      (job) => job.name === SEND_MOVE_JOB_NAME
    )
    expect(continuation).toBeDefined()
    expect(continuation.id).toBe(
      `${MIGRATION}:continue:followers:${continuation.data.cursor}`
    )
    expect(continuation.data).toMatchObject({
      migrationId: MIGRATION,
      originActorId: ORIGIN,
      targetActorId: TARGET
    })
    // Only the first page of two followers was handled.
    expect(
      followerJobs().length +
        new Set(deliveries().map((j) => j.data.inbox)).size
    ).toBeLessThanOrEqual(2)

    // Resume every slice to the end: all followers covered, no relationship
    // jobs republished by a continuation.
    let next: ReturnType<typeof message> | undefined = continuation
    let guard = 0
    while (next && guard++ < 10) {
      mockPublish.mockClear()
      await runSendMove(database, message(next.data, next.id), {
        budgetMs: 0,
        pageSize: 2
      })
      expect(
        published().some((job) => job.name === MOVE_RELATIONSHIPS_JOB_NAME)
      ).toBe(false)
      next = published().find((job) => job.name === SEND_MOVE_JOB_NAME)
    }
    expect(guard).toBeLessThan(10)
  })

  it('keys a shared inbox on the migration across pages and covers every follower', async () => {
    const all: ReturnType<typeof published> = []
    let next: ReturnType<typeof message> | undefined = message()
    let slices = 0
    while (next && slices++ < 20) {
      mockPublish.mockClear()
      await runSendMove(database, next, { budgetMs: 0, pageSize: 1 })
      all.push(...published())
      const continuation = published().find(
        (job) => job.name === SEND_MOVE_JOB_NAME
      )
      next = continuation && message(continuation.data, continuation.id)
    }
    expect(slices).toBeLessThan(20)

    const sent = all.filter((job) => job.name === DELIVER_ACTIVITY_JOB_NAME)
    // somewhere.test/inbox is shared by two followers on two different pages.
    expect(
      sent.filter((job) => job.data.inbox === 'https://somewhere.test/inbox')
    ).toHaveLength(2)
    expect(new Set(sent.map((job) => job.id))).toEqual(
      new Set(
        ['https://somewhere.test/inbox', 'https://other.test/inbox'].map(
          (inbox) => getDeliveryJobId(MIGRATION, inbox)
        )
      )
    )
    expect(new Set(sent.map((job) => job.data.inbox))).toEqual(
      new Set(['https://somewhere.test/inbox', 'https://other.test/inbox'])
    )
    expect(
      all.filter((job) => job.name === MOVE_FOLLOWER_JOB_NAME)
    ).toHaveLength(2)
  })

  describe('blockers and relays', () => {
    const blocker = async (name: string, sharedInbox: string) => {
      const actorId = `https://blocker.test/users/${name}`
      await database.createActor({
        actorId,
        username: name,
        domain: 'blocker.test',
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: sharedInbox,
        followersUrl: `${actorId}/followers`,
        publicKey: 'publicKey',
        createdAt: Date.now()
      })
      await database.createBlock({
        actorId,
        targetActorId: ORIGIN,
        uri: `${actorId}#blocks/1`
      })
    }
    const relay = async (inboxUrl: string, state: 'accepted' | 'pending') => {
      const created = await database.createRelay({ inboxUrl })
      await database.updateRelay({ id: created.id, state })
    }
    // Runs every slice (one page each) and returns everything published.
    const runAll = async () => {
      const all: ReturnType<typeof published> = []
      const slices: ReturnType<typeof published>[] = []
      let next: ReturnType<typeof message> | undefined = message()
      while (next && slices.length < 30) {
        mockPublish.mockClear()
        await runSendMove(database, next, { budgetMs: 0, pageSize: 1 })
        slices.push(published())
        all.push(...published())
        const continuation = published().find(
          (job) => job.name === SEND_MOVE_JOB_NAME
        )
        next = continuation && message(continuation.data, continuation.id)
      }
      expect(slices.length).toBeLessThan(30)
      return { all, slices }
    }
    const inboxesOf = (jobs: ReturnType<typeof published>) =>
      jobs
        .filter((job) => job.name === DELIVER_ACTIVITY_JOB_NAME)
        .map((job) => job.data.inbox)

    it('delivers the Move to the inbox of a remote account that blocks the origin', async () => {
      await blocker('b1', 'https://blocker.test/inbox')
      await sendMoveJob(database, message())

      expect(inboxesOf(published()).sort()).toEqual([
        'https://blocker.test/inbox',
        'https://other.test/inbox',
        'https://somewhere.test/inbox'
      ])
    })

    it('never delivers to a local account that blocks the origin', async () => {
      await database.createBlock({
        actorId: ACTOR2_ID,
        targetActorId: ORIGIN,
        uri: `${ACTOR2_ID}#blocks/1`
      })
      await sendMoveJob(database, message())

      expect(inboxesOf(published())).toHaveLength(2)
    })

    it('gives an inbox shared by a follower and a blocker one delivery id', async () => {
      await blocker('b2', 'https://other.test/inbox')
      const { all } = await runAll()

      const sent = all.filter((job) => job.name === DELIVER_ACTIVITY_JOB_NAME)
      expect(
        new Set(
          sent
            .filter((job) => job.data.inbox === 'https://other.test/inbox')
            .map((job) => job.id)
        )
      ).toEqual(
        new Set([getDeliveryJobId(MIGRATION, 'https://other.test/inbox')])
      )
    })

    it('delivers to accepted relays on the first slice only', async () => {
      await relay('https://relay.test/inbox', 'accepted')
      await relay('https://pending-relay.test/inbox', 'pending')
      const { slices } = await runAll()

      expect(slices.length).toBeGreaterThan(1)
      expect(inboxesOf(slices[0])).toContain('https://relay.test/inbox')
      expect(inboxesOf(slices[0])).not.toContain(
        'https://pending-relay.test/inbox'
      )
      expect(inboxesOf(slices.slice(1).flat())).not.toContain(
        'https://relay.test/inbox'
      )
    })

    it('continues through the follower phase and then the blocker phase', async () => {
      await blocker('b3', 'https://blocker.test/inbox')
      await blocker('b4', 'https://blocker2.test/inbox')
      const { all, slices } = await runAll()

      expect(new Set(inboxesOf(all))).toEqual(
        new Set([
          'https://somewhere.test/inbox',
          'https://other.test/inbox',
          'https://blocker.test/inbox',
          'https://blocker2.test/inbox'
        ])
      )
      const continuations = slices
        .map((slice) => slice.find((job) => job.name === SEND_MOVE_JOB_NAME))
        .filter((job) => job !== undefined)
      expect(continuations.map((job) => job.data.phase)).toContain('blockers')
      expect(new Set(continuations.map((job) => job.id)).size).toBe(
        continuations.length
      )
      expect(
        all.filter((job) => job.name === MOVE_FOLLOWER_JOB_NAME)
      ).toHaveLength(2)
    })
  })

  it('does nothing when the move was cancelled before it started', async () => {
    await database.updateActor({ actorId: ORIGIN, movedTo: null })
    await sendMoveJob(database, message())

    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('still completes the fan-out when the move was deleted after it started', async () => {
    await database.markActorMigrationStarted({ id: MIGRATION })
    await database.updateActor({ actorId: ORIGIN, movedTo: null })
    await sendMoveJob(database, message())

    expect(followerJobs()).toHaveLength(2)
    expect(deliveries()).toHaveLength(2)
  })

  it('does nothing when no started or pointed move names the migration', async () => {
    await sendMoveJob(database, message({ migrationId: 'unknown-migration' }))

    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('does nothing when the migration names a different target', async () => {
    await database.markActorMigrationStarted({ id: MIGRATION })
    await sendMoveJob(database, message({ targetActorId: ACTOR2_ID }))

    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('does nothing when movedTo points at a different target before the start', async () => {
    await database.updateActor({
      actorId: ORIGIN,
      movedTo: 'https://elsewhere.test/users/test1'
    })
    await sendMoveJob(database, message())

    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('does nothing for a remote origin', async () => {
    await sendMoveJob(
      database,
      message({ originActorId: 'https://somewhere.test/actors/friend' })
    )

    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('retries the page when a real queue refuses a job', async () => {
    mockPublish.mockRejectedValue(new Error('queue unavailable'))

    await expect(sendMoveJob(database, message())).rejects.toThrow('move jobs')
  })
})
