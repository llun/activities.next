import { follow, unfollow } from '@/lib/activities'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import {
  getMoveFollowId,
  getMoveFollowerJobId,
  getMoveUndoJobId,
  moveFollowerJob
} from '@/lib/jobs/moveFollowerJob'
import {
  MOVE_FOLLOWER_JOB_NAME,
  SEND_UNDO_FOLLOW_JOB_NAME
} from '@/lib/jobs/names'
import { sendUndoFollowJob } from '@/lib/jobs/sendUndoFollowJob'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { NotificationType } from '@/lib/types/database/operations'
import { type Follow, FollowStatus } from '@/lib/types/domain/follow'

const mockPublish = vi.hoisted(() => vi.fn())

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))
vi.mock('@/lib/activities', () => ({ follow: vi.fn(), unfollow: vi.fn() }))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

const ORIGIN = EXTERNAL_ACTOR1
const TARGET = 'https://newhome.test/users/test1'

describe('moveFollowerJob', () => {
  let database: Database

  beforeEach(async () => {
    const created = createTestDatabase()
    database = created.database
    await created.prepare()
    await database.migrate()
    await seedDatabase(database)

    mockPublish.mockReset()
    vi.mocked(sendNotificationAlerts).mockReset()
    vi.mocked(follow).mockReset().mockResolvedValue(true)
    vi.mocked(unfollow).mockReset().mockResolvedValue(true)
    // What MoveActorJob leaves behind: the stored target, and the origin
    // pointing at it.
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
    originFollowIds.clear()
    originFollowIds.set(
      ACTOR1_ID,
      (await active(ACTOR1_ID, ORIGIN))?.id as string
    )
  })

  afterEach(async () => {
    await database.destroy()
  })

  const active = (actorId: string, targetActorId: string) =>
    database.getAcceptedOrRequestedFollow({ actorId, targetActorId })

  // The origin follow of each follower, kept to read it after it was undone.
  const originFollowIds = new Map<string, string>()

  const run = async (actorId = ACTOR1_ID, targetActorId = TARGET) => {
    const followId = originFollowIds.get(actorId) as string
    return moveFollowerJob(database, {
      id: getMoveFollowerJobId(followId, targetActorId),
      name: MOVE_FOLLOWER_JOB_NAME,
      data: { followId, targetActorId }
    })
  }

  const followOrigin = async (actorId: string) => {
    const created = await database.createFollow({
      actorId,
      targetActorId: ORIGIN,
      status: FollowStatus.enum.Accepted,
      inbox: `${actorId}/inbox`,
      sharedInbox: 'https://llun.test/inbox'
    })
    originFollowIds.set(actorId, created.id)
    return created
  }

  // The follow the job itself makes for this follower: the deterministic id.
  const ownId = (actorId = ACTOR1_ID) =>
    getMoveFollowId(originFollowIds.get(actorId) as string, TARGET)

  const followTarget = (actorId: string, status: FollowStatus, id?: string) =>
    database.createFollow({
      id,
      actorId,
      targetActorId: TARGET,
      status,
      inbox: `${actorId}/inbox`,
      sharedInbox: 'https://llun.test/inbox'
    })

  const originStatus = async (actorId = ACTOR1_ID) =>
    (
      await database.getFollowFromId({
        followId: originFollowIds.get(actorId) as string
      })
    )?.status

  it('follows the target, moves the lists and undoes the origin follow', async () => {
    const oldFollow = await active(ACTOR1_ID, ORIGIN)
    const list = await database.createList({
      actorId: ACTOR1_ID,
      title: 'People'
    })
    await database.addListAccounts({
      listId: list.id,
      actorId: ACTOR1_ID,
      targetActorIds: [ORIGIN]
    })
    await database.updateFollowPreferences({
      actorId: ACTOR1_ID,
      targetActorId: ORIGIN,
      reblogs: false,
      notify: true,
      languages: ['en']
    })

    await run()

    expect(follow).toHaveBeenCalledTimes(1)
    expect(follow).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: ACTOR1_ID }),
      TARGET,
      undefined
    )
    expect(await active(ACTOR1_ID, TARGET)).toMatchObject({
      status: FollowStatus.enum.Requested,
      reblogs: false,
      notify: true,
      languages: ['en']
    })
    expect(await originStatus()).toBe(FollowStatus.enum.Undo)
    expect(mockPublish).toHaveBeenCalledWith({
      id: getMoveUndoJobId(oldFollow?.id as string),
      name: SEND_UNDO_FOLLOW_JOB_NAME,
      data: {
        actorId: ACTOR1_ID,
        follow: expect.objectContaining({ id: oldFollow?.id })
      }
    })
    expect(
      (
        await database.getListsWithAccount({
          actorId: ACTOR1_ID,
          targetActorId: TARGET
        })
      ).map(({ id }) => id)
    ).toEqual([list.id])
    expect(
      await database.getListsWithAccount({
        actorId: ACTOR1_ID,
        targetActorId: ORIGIN
      })
    ).toEqual([])
  })

  it('does nothing when the origin follow is no longer accepted', async () => {
    await database.updateFollowStatus({
      followId: originFollowIds.get(ACTOR1_ID) as string,
      status: FollowStatus.enum.Undo
    })

    await run()

    expect(follow).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
    expect(await active(ACTOR1_ID, TARGET)).toBeNull()
  })

  it('does nothing when the origin has not moved to that target', async () => {
    await database.updateActor({
      actorId: ORIGIN,
      movedTo: 'https://elsewhere.test/users/test1'
    })

    await run()

    expect(follow).not.toHaveBeenCalled()
    expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
  })

  it('is idempotent on redelivery', async () => {
    await run()
    await run()

    expect(follow).toHaveBeenCalledTimes(1)
    // The second delivery repeats the Undo with the same id, which is safe.
    expect(mockPublish.mock.calls.map(([job]) => job.id)).toEqual([
      getMoveUndoJobId(originFollowIds.get(ACTOR1_ID) as string),
      getMoveUndoJobId(originFollowIds.get(ACTOR1_ID) as string)
    ])
    expect((await active(ACTOR1_ID, TARGET))?.id).toBe(ownId())
    expect(await originStatus()).toBe(FollowStatus.enum.Undo)
  })

  it('makes the follow with an id derived from the origin follow and the target', async () => {
    await run()

    expect((await active(ACTOR1_ID, TARGET))?.id).toBe(ownId())
    expect(ownId()).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
  })

  it('marks the origin follow undone before it queues the Undo', async () => {
    mockPublish.mockImplementationOnce(async () => {
      expect(await originStatus()).toBe(FollowStatus.enum.Undo)
    })

    await run()

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(await originStatus()).toBe(FollowStatus.enum.Undo)
  })

  it('delivers the Undo Follow when the queue runs the handler inline', async () => {
    mockPublish.mockImplementation(async (job) => {
      if (job.name === SEND_UNDO_FOLLOW_JOB_NAME) {
        await sendUndoFollowJob(database, job)
      }
    })

    await run()

    expect(unfollow).toHaveBeenCalledTimes(1)
    expect(unfollow).toHaveBeenCalledWith(
      expect.objectContaining({ id: ACTOR1_ID }),
      expect.objectContaining({
        id: originFollowIds.get(ACTOR1_ID),
        targetActorId: ORIGIN,
        status: FollowStatus.enum.Undo
      })
    )
  })

  it('leaves the origin follow and the lists when its own follow was ended after create', async () => {
    const list = await database.createList({
      actorId: ACTOR1_ID,
      title: 'People'
    })
    await database.addListAccounts({
      listId: list.id,
      actorId: ACTOR1_ID,
      targetActorIds: [ORIGIN]
    })
    // The row exists as the job's own but ended between its check and the
    // insert (the insert reports the other writer's row).
    vi.spyOn(database, 'createFollowIfAbsent').mockResolvedValue({
      follow: {
        id: ownId(),
        actorId: ACTOR1_ID,
        targetActorId: TARGET,
        status: FollowStatus.enum.Rejected
      } as Follow,
      inserted: false
    })

    await run()

    expect(follow).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
    expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
    expect(
      (
        await database.getListsWithAccount({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN
        })
      ).map(({ id }) => id)
    ).toEqual([list.id])
  })

  it('republishes the Undo on retry when the queue was down after the flip', async () => {
    mockPublish.mockRejectedValueOnce(new Error('queue down'))

    await expect(run()).rejects.toThrow('queue down')
    expect(await originStatus()).toBe(FollowStatus.enum.Undo)

    await run()

    // The retry only repeats the Undo job (same id); the Follow is not resent.
    expect(follow).toHaveBeenCalledTimes(1)
    expect(mockPublish).toHaveBeenCalledTimes(2)
    expect(mockPublish.mock.calls[1][0].id).toBe(
      getMoveUndoJobId(originFollowIds.get(ACTOR1_ID) as string)
    )
    expect((await active(ACTOR1_ID, TARGET))?.id).toBe(ownId())
  })

  describe('the Undo republish', () => {
    it('repeats the Undo when the origin follow is Undo and the job made its own follow', async () => {
      await followTarget(ACTOR1_ID, FollowStatus.enum.Requested, ownId())
      await database.updateFollowStatus({
        followId: originFollowIds.get(ACTOR1_ID) as string,
        status: FollowStatus.enum.Undo
      })

      await run()

      expect(follow).not.toHaveBeenCalled()
      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          id: getMoveUndoJobId(originFollowIds.get(ACTOR1_ID) as string),
          name: SEND_UNDO_FOLLOW_JOB_NAME
        })
      )
    })

    it('does nothing for an Undo origin follow when the job made no follow', async () => {
      await followTarget(ACTOR1_ID, FollowStatus.enum.Accepted)
      await database.updateFollowStatus({
        followId: originFollowIds.get(ACTOR1_ID) as string,
        status: FollowStatus.enum.Undo
      })

      await run()

      expect(mockPublish).not.toHaveBeenCalled()
    })

    it('repeats the Undo when the job own follow was rejected after the flip', async () => {
      await followTarget(ACTOR1_ID, FollowStatus.enum.Rejected, ownId())
      await database.updateFollowStatus({
        followId: originFollowIds.get(ACTOR1_ID) as string,
        status: FollowStatus.enum.Undo
      })

      await run()

      expect(follow).not.toHaveBeenCalled()
      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          id: getMoveUndoJobId(originFollowIds.get(ACTOR1_ID) as string),
          name: SEND_UNDO_FOLLOW_JOB_NAME
        })
      )
    })

    it('repeats the Undo when a profile refresh cleared movedTo after the flip', async () => {
      await followTarget(ACTOR1_ID, FollowStatus.enum.Accepted, ownId())
      await database.updateFollowStatus({
        followId: originFollowIds.get(ACTOR1_ID) as string,
        status: FollowStatus.enum.Undo
      })
      await database.updateActor({ actorId: ORIGIN, movedTo: null })
      expect(
        (await database.getActorFromId({ id: ORIGIN }))?.movedTo
      ).toBeFalsy()

      await run()

      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          id: getMoveUndoJobId(originFollowIds.get(ACTOR1_ID) as string),
          name: SEND_UNDO_FOLLOW_JOB_NAME
        })
      )
    })

    it('does nothing for an Accepted origin follow when the origin moved elsewhere', async () => {
      await database.updateActor({
        actorId: ORIGIN,
        movedTo: 'https://elsewhere.test/users/test1'
      })

      await run()

      expect(mockPublish).not.toHaveBeenCalled()
      expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
    })
  })

  describe("the job's own follow left by a run that died", () => {
    it('completes the move when it is Accepted and the origin follow still is', async () => {
      await followTarget(ACTOR1_ID, FollowStatus.enum.Accepted, ownId())
      const list = await database.createList({
        actorId: ACTOR1_ID,
        title: 'People'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: ACTOR1_ID,
        targetActorIds: [ORIGIN]
      })

      await run()

      expect(follow).not.toHaveBeenCalled()
      expect(await originStatus()).toBe(FollowStatus.enum.Undo)
      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect((await active(ACTOR1_ID, TARGET))?.id).toBe(ownId())
      expect(
        await database.getListsWithAccount({
          actorId: ACTOR1_ID,
          targetActorId: ORIGIN
        })
      ).toEqual([])
    })

    it('sends a Requested one again, for the same row, then completes', async () => {
      await followTarget(ACTOR1_ID, FollowStatus.enum.Requested, ownId())

      await run()

      expect(follow).toHaveBeenCalledTimes(1)
      expect(follow).toHaveBeenCalledWith(
        ownId(),
        expect.objectContaining({ id: ACTOR1_ID }),
        TARGET,
        undefined
      )
      expect(await originStatus()).toBe(FollowStatus.enum.Undo)
      expect(mockPublish).toHaveBeenCalledTimes(1)
    })

    it('leaves the origin follow when its own follow was rejected', async () => {
      await followTarget(ACTOR1_ID, FollowStatus.enum.Rejected, ownId())

      await run()

      expect(follow).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
      expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
    })
  })

  it('does not follow a target that was suspended after the fan-out', async () => {
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

    await run()

    expect(follow).not.toHaveBeenCalled()
    expect(mockPublish).not.toHaveBeenCalled()
    expect(await active(ACTOR1_ID, TARGET)).toBeNull()
    expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
  })

  it('does not follow a target that has itself moved', async () => {
    await database.updateActor({
      actorId: TARGET,
      movedTo: 'https://third.test/users/test1'
    })

    await run()

    expect(follow).not.toHaveBeenCalled()
    expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
  })

  it('does not follow a target whose domain is blocked', async () => {
    await database.createDomainBlock({
      domain: 'newhome.test',
      severity: 'suspend'
    })

    await run()

    expect(follow).not.toHaveBeenCalled()
    expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
  })

  describe('a follower that already follows the target', () => {
    it('copies the options, moves the lists and keeps the origin follow', async () => {
      await followTarget(ACTOR1_ID, FollowStatus.enum.Accepted)
      await database.updateFollowPreferences({
        actorId: ACTOR1_ID,
        targetActorId: ORIGIN,
        reblogs: false,
        notify: true,
        languages: ['th']
      })
      const list = await database.createList({
        actorId: ACTOR1_ID,
        title: 'People'
      })
      await database.addListAccounts({
        listId: list.id,
        actorId: ACTOR1_ID,
        targetActorIds: [ORIGIN]
      })

      await run()

      expect(follow).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
      expect(await active(ACTOR1_ID, TARGET)).toMatchObject({
        status: FollowStatus.enum.Accepted,
        reblogs: false,
        notify: true,
        languages: ['th']
      })
      expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
      expect(
        (
          await database.getListsWithAccount({
            actorId: ACTOR1_ID,
            targetActorId: TARGET
          })
        ).map(({ id }) => id)
      ).toEqual([list.id])
      // The origin follow stays, so the origin stays in the list too.
      expect(
        (
          await database.getListsWithAccount({
            actorId: ACTOR1_ID,
            targetActorId: ORIGIN
          })
        ).map(({ id }) => id)
      ).toEqual([list.id])
    })

    it('keeps the language filter of its own follow when the origin has none', async () => {
      await followTarget(ACTOR1_ID, FollowStatus.enum.Accepted)
      await database.updateFollowPreferences({
        actorId: ACTOR1_ID,
        targetActorId: TARGET,
        languages: ['th']
      })

      await run()

      expect(await active(ACTOR1_ID, TARGET)).toMatchObject({
        languages: ['th']
      })
    })

    it("treats the user's own Requested follow the same way: options copied, origin kept, nothing sent", async () => {
      const theirs = await followTarget(ACTOR1_ID, FollowStatus.enum.Requested)
      await database.updateFollowPreferences({
        actorId: ACTOR1_ID,
        targetActorId: ORIGIN,
        reblogs: false,
        notify: true,
        languages: ['en']
      })

      await run()

      expect(follow).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
      expect(await active(ACTOR1_ID, TARGET)).toMatchObject({
        id: theirs.id,
        status: FollowStatus.enum.Requested,
        reblogs: false,
        notify: true,
        languages: ['en']
      })
      expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
    })
  })

  it('leaves a pending request to a local target pending for a remote origin', async () => {
    mockPublish.mockResolvedValue(undefined)
    await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })
    const pending = await database.createFollow({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID,
      status: FollowStatus.enum.Requested,
      inbox: `${ACTOR1_ID}/inbox`,
      sharedInbox: 'https://llun.test/inbox'
    })

    await run(ACTOR1_ID, ACTOR2_ID)

    expect(
      (await database.getFollowFromId({ followId: pending.id }))?.status
    ).toBe(FollowStatus.enum.Requested)
    expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
  })

  it('keeps its Requested row when the Follow is not delivered, then sends the same row', async () => {
    vi.mocked(follow).mockResolvedValueOnce(false)

    await expect(run()).rejects.toThrow('was not sent')
    expect(await active(ACTOR1_ID, TARGET)).toMatchObject({
      id: ownId(),
      status: FollowStatus.enum.Requested
    })
    expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
    expect(mockPublish).not.toHaveBeenCalled()

    await run()

    expect(follow).toHaveBeenCalledTimes(2)
    expect(vi.mocked(follow).mock.calls.map(([id]) => id)).toEqual([
      ownId(),
      ownId()
    ])
    expect((await active(ACTOR1_ID, TARGET))?.id).toBe(ownId())
    expect(await originStatus()).toBe(FollowStatus.enum.Undo)
  })

  it('finishes with a single Accepted follow when a late Accept follows a failed send', async () => {
    vi.mocked(follow).mockResolvedValueOnce(false)
    await expect(run()).rejects.toThrow('was not sent')

    // The target did receive the first Follow and accepts it late.
    await database.updateFollowStatus({
      followId: ownId(),
      status: FollowStatus.enum.Accepted
    })
    await run()

    expect(follow).toHaveBeenCalledTimes(1)
    expect(await originStatus()).toBe(FollowStatus.enum.Undo)
    expect(
      (await database.getFollowFromId({ followId: ownId() }))?.status
    ).toBe(FollowStatus.enum.Accepted)
    expect(
      await database.getAcceptedFollowTargetActorIds({
        actorId: ACTOR1_ID,
        targetActorIds: [TARGET]
      })
    ).toEqual([TARGET])
    expect(
      (await database.getFollowing({ actorId: ACTOR1_ID, limit: 50 })).filter(
        ({ targetActorId }) => targetActorId === TARGET
      )
    ).toHaveLength(1)
  })

  it('creates one row when two deliveries race', async () => {
    await Promise.all([run(), run()])

    const rows = (
      await database.getFollowing({ actorId: ACTOR1_ID, limit: 50 })
    ).filter(({ targetActorId }) => targetActorId === TARGET)
    expect(rows.length).toBeLessThanOrEqual(1)
    expect((await active(ACTOR1_ID, TARGET))?.id).toBe(ownId())
    expect(await originStatus()).toBe(FollowStatus.enum.Undo)
  })

  it('moves the other followers when one fails, and resumes it on retry', async () => {
    await followOrigin(ACTOR2_ID)
    vi.mocked(follow).mockImplementation(
      async (_id, actor) => actor.id !== ACTOR2_ID || false
    )

    await run(ACTOR1_ID)
    await expect(run(ACTOR2_ID)).rejects.toThrow('was not sent')

    expect(await originStatus(ACTOR1_ID)).toBe(FollowStatus.enum.Undo)
    expect(await originStatus(ACTOR2_ID)).toBe(FollowStatus.enum.Accepted)
    expect((await active(ACTOR2_ID, TARGET))?.id).toBe(ownId(ACTOR2_ID))

    vi.mocked(follow).mockResolvedValue(true)
    await run(ACTOR2_ID)
    await run(ACTOR1_ID)

    expect(await originStatus(ACTOR2_ID)).toBe(FollowStatus.enum.Undo)
    expect(await active(ACTOR2_ID, TARGET)).not.toBeNull()
    // First follower: once. Second: the failed try and the retry.
    expect(
      vi.mocked(follow).mock.calls.filter(([, actor]) => actor.id === ACTOR1_ID)
    ).toHaveLength(1)
    expect(
      vi.mocked(follow).mock.calls.filter(([, actor]) => actor.id === ACTOR2_ID)
    ).toHaveLength(2)
  })

  describe('leaves the origin follow alone', () => {
    it('for an account that blocks the target', async () => {
      await database.createBlock({
        actorId: ACTOR1_ID,
        targetActorId: TARGET,
        uri: `${ACTOR1_ID}/blocks/1`
      })

      await run()

      expect(follow).not.toHaveBeenCalled()
      expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
    })

    it('for an account the target blocks', async () => {
      await database.createBlock({
        actorId: TARGET,
        targetActorId: ACTOR1_ID,
        uri: `${TARGET}/blocks/1`
      })

      await run()

      expect(follow).not.toHaveBeenCalled()
      expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
    })

    it('for an account that blocks the target domain', async () => {
      await database.createActorDomainBlock({
        actorId: ACTOR1_ID,
        domain: 'newhome.test'
      })

      await run()

      expect(follow).not.toHaveBeenCalled()
      expect(await active(ACTOR1_ID, TARGET)).toBeNull()
      expect(await originStatus()).toBe(FollowStatus.enum.Accepted)
    })
  })

  describe('local origin (outgoing move)', () => {
    const LOCAL_ORIGIN = ACTOR2_ID

    const setup = async (movedTo: string) => {
      await database.updateActor({ actorId: LOCAL_ORIGIN, movedTo })
      const oldFollow = await database.createFollow({
        actorId: ACTOR1_ID,
        targetActorId: LOCAL_ORIGIN,
        status: FollowStatus.enum.Accepted,
        inbox: `${ACTOR1_ID}/inbox`,
        sharedInbox: 'https://llun.test/inbox'
      })
      return oldFollow
    }

    const runLocal = (followId: string, targetActorId: string) =>
      moveFollowerJob(database, {
        id: getMoveFollowerJobId(followId, targetActorId),
        name: MOVE_FOLLOWER_JOB_NAME,
        data: { followId, targetActorId }
      })

    it('follows a remote target and ends the old follow without an Undo to ourselves', async () => {
      const oldFollow = await setup(TARGET)

      await runLocal(oldFollow.id, TARGET)

      expect(follow).toHaveBeenCalledTimes(1)
      expect((await active(ACTOR1_ID, TARGET))?.status).toBe(
        FollowStatus.enum.Requested
      )
      expect(
        (await database.getFollowFromId({ followId: oldFollow.id }))?.status
      ).toBe(FollowStatus.enum.Undo)
      expect(mockPublish).not.toHaveBeenCalled()
    })

    it('rewrites the follow to a local target (Mastodon rewrite_follows)', async () => {
      const oldFollow = await setup(ACTOR3_ID)

      await runLocal(oldFollow.id, ACTOR3_ID)

      expect(follow).not.toHaveBeenCalled()
      expect((await active(ACTOR1_ID, ACTOR3_ID))?.status).toBe(
        FollowStatus.enum.Accepted
      )
      expect(
        (await database.getFollowFromId({ followId: oldFollow.id }))?.status
      ).toBe(FollowStatus.enum.Undo)
      expect(mockPublish).not.toHaveBeenCalled()
    })

    describe('a pending request to a local target', () => {
      const requestTarget = async () => {
        mockPublish.mockResolvedValue(undefined)
        const oldFollow = await setup(ACTOR3_ID)
        const pending = await database.createFollow({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR3_ID,
          status: FollowStatus.enum.Requested,
          inbox: `${ACTOR1_ID}/inbox`,
          sharedInbox: 'https://llun.test/inbox'
        })
        await database.createNotification({
          actorId: ACTOR3_ID,
          type: NotificationType.enum.follow_request,
          sourceActorId: ACTOR1_ID,
          followId: pending.id
        })
        return { oldFollow, pending }
      }

      it('is authorized silently and the origin follow is kept (MoveWorker rewrite_follows!)', async () => {
        const { oldFollow, pending } = await requestTarget()

        await runLocal(oldFollow.id, ACTOR3_ID)

        expect(follow).not.toHaveBeenCalled()
        expect(
          (await database.getFollowFromId({ followId: pending.id }))?.status
        ).toBe(FollowStatus.enum.Accepted)
        expect(
          (await database.getFollowFromId({ followId: oldFollow.id }))?.status
        ).toBe(FollowStatus.enum.Accepted)
        // Mastodon's authorize! sends no alert, and the request notification
        // is gone rather than left pending.
        expect(sendNotificationAlerts).not.toHaveBeenCalled()
        expect(
          await database.getNotificationFromFollowId({ followId: pending.id })
        ).toBeNull()
      })

      it('stays pending for a silenced follower', async () => {
        await database.setActorSilenced({ actorId: ACTOR1_ID, silenced: true })
        const { oldFollow, pending } = await requestTarget()

        await runLocal(oldFollow.id, ACTOR3_ID)

        expect(
          (await database.getFollowFromId({ followId: pending.id }))?.status
        ).toBe(FollowStatus.enum.Requested)
        expect(sendNotificationAlerts).not.toHaveBeenCalled()
        expect(
          await database.getNotificationFromFollowId({ followId: pending.id })
        ).not.toBeNull()
      })
    })

    it('does nothing when the local origin has not moved to the target', async () => {
      const oldFollow = await setup(TARGET)

      await runLocal(oldFollow.id, ACTOR3_ID)

      expect(await active(ACTOR1_ID, ACTOR3_ID)).toBeNull()
      expect(
        (await database.getFollowFromId({ followId: oldFollow.id }))?.status
      ).toBe(FollowStatus.enum.Accepted)
    })
  })

  describe('local target', () => {
    it('creates an Accepted follow, notifies the local target, flips the origin to Undo and publishes Undo without network follow', async () => {
      await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })
      const oldFollow = await active(ACTOR1_ID, ORIGIN)
      const expectedFollowId = getMoveFollowId(
        oldFollow?.id as string,
        ACTOR2_ID
      )

      await run(ACTOR1_ID, ACTOR2_ID)

      expect(follow).not.toHaveBeenCalled()

      const createdFollow = await active(ACTOR1_ID, ACTOR2_ID)
      expect(createdFollow).toMatchObject({
        id: expectedFollowId,
        actorId: ACTOR1_ID,
        targetActorId: ACTOR2_ID,
        status: FollowStatus.enum.Accepted
      })

      const notifications = await database.getNotifications({
        actorId: ACTOR2_ID,
        limit: 10
      })
      expect(notifications).toHaveLength(1)
      expect(notifications[0]).toMatchObject({
        actorId: ACTOR2_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR1_ID,
        followId: expectedFollowId
      })

      expect(sendNotificationAlerts).toHaveBeenCalledTimes(1)
      expect(sendNotificationAlerts).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ACTOR2_ID,
          sourceActorId: ACTOR1_ID,
          events: [
            expect.objectContaining({
              type: NotificationType.enum.follow,
              notificationId: notifications[0].id,
              emailContent: expect.objectContaining({
                recipientEmail: 'test2@llun.test'
              })
            })
          ]
        })
      )

      expect(await originStatus()).toBe(FollowStatus.enum.Undo)
      expect(mockPublish).toHaveBeenCalledWith({
        id: getMoveUndoJobId(oldFollow?.id as string),
        name: SEND_UNDO_FOLLOW_JOB_NAME,
        data: {
          actorId: ACTOR1_ID,
          follow: expect.objectContaining({ id: oldFollow?.id })
        }
      })
    })

    it('creates follow as Accepted immediately even when local target manually approves followers', async () => {
      await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })
      await database.updateActor({
        actorId: ACTOR2_ID,
        manuallyApprovesFollowers: true
      })
      const oldFollow = await active(ACTOR1_ID, ORIGIN)
      const expectedFollowId = getMoveFollowId(
        oldFollow?.id as string,
        ACTOR2_ID
      )

      await run(ACTOR1_ID, ACTOR2_ID)

      expect(follow).not.toHaveBeenCalled()
      expect(await active(ACTOR1_ID, ACTOR2_ID)).toMatchObject({
        id: expectedFollowId,
        status: FollowStatus.enum.Accepted
      })
      expect(await originStatus()).toBe(FollowStatus.enum.Undo)
    })

    it('skips a follower that is the target account', async () => {
      await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR1_ID })

      await run(ACTOR1_ID, ACTOR1_ID)

      expect(follow).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
      expect(sendNotificationAlerts).not.toHaveBeenCalled()
      expect(await active(ACTOR1_ID, ACTOR1_ID)).toBeNull()
      expect(await originStatus(ACTOR1_ID)).toBe(FollowStatus.enum.Accepted)
    })

    it('is idempotent on retry: no second follow row, no duplicate notification', async () => {
      await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })

      await run(ACTOR1_ID, ACTOR2_ID)
      await run(ACTOR1_ID, ACTOR2_ID)

      expect(follow).not.toHaveBeenCalled()
      expect(sendNotificationAlerts).toHaveBeenCalledTimes(1)

      const notifications = await database.getNotifications({
        actorId: ACTOR2_ID,
        limit: 10
      })
      expect(notifications).toHaveLength(1)

      const follows = (
        await database.getFollowing({ actorId: ACTOR1_ID, limit: 50 })
      ).filter(({ targetActorId }) => targetActorId === ACTOR2_ID)
      expect(follows).toHaveLength(1)
      expect(follows[0].status).toBe(FollowStatus.enum.Accepted)
      expect(await originStatus(ACTOR1_ID)).toBe(FollowStatus.enum.Undo)
    })

    it('does not send duplicate notifications when two deliveries run concurrently', async () => {
      await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })

      await Promise.all([run(ACTOR1_ID, ACTOR2_ID), run(ACTOR1_ID, ACTOR2_ID)])

      expect(sendNotificationAlerts).toHaveBeenCalledTimes(1)
      const notifications = await database.getNotifications({
        actorId: ACTOR2_ID,
        limit: 10
      })
      expect(notifications).toHaveLength(1)
    })

    it('transitions existing Requested row to Accepted on retry without calling send()', async () => {
      await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })
      const oldFollow = await active(ACTOR1_ID, ORIGIN)
      const ownLocalId = getMoveFollowId(oldFollow?.id as string, ACTOR2_ID)

      await database.createFollow({
        id: ownLocalId,
        actorId: ACTOR1_ID,
        targetActorId: ACTOR2_ID,
        status: FollowStatus.enum.Requested,
        inbox: `${ACTOR1_ID}/inbox`,
        sharedInbox: 'https://llun.test/inbox'
      })

      await run(ACTOR1_ID, ACTOR2_ID)

      expect(follow).not.toHaveBeenCalled()
      expect(
        (await database.getFollowFromId({ followId: ownLocalId }))?.status
      ).toBe(FollowStatus.enum.Accepted)
      expect(await originStatus()).toBe(FollowStatus.enum.Undo)
      expect(mockPublish).toHaveBeenCalledTimes(1)
    })

    it('creates a Requested follow and follow_request notification for a silenced follower without network follow, flips origin to Undo, and leaves Requested on retry without duplicate notification', async () => {
      await database.setActorSilenced({ actorId: ACTOR1_ID, silenced: true })
      await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })
      const oldFollow = await active(ACTOR1_ID, ORIGIN)
      const expectedFollowId = getMoveFollowId(
        oldFollow?.id as string,
        ACTOR2_ID
      )

      await run(ACTOR1_ID, ACTOR2_ID)

      expect(follow).not.toHaveBeenCalled()

      const createdFollow = await active(ACTOR1_ID, ACTOR2_ID)
      expect(createdFollow).toMatchObject({
        id: expectedFollowId,
        actorId: ACTOR1_ID,
        targetActorId: ACTOR2_ID,
        status: FollowStatus.enum.Requested
      })

      const notifications = await database.getNotifications({
        actorId: ACTOR2_ID,
        limit: 10
      })
      expect(notifications).toHaveLength(1)
      expect(notifications[0]).toMatchObject({
        actorId: ACTOR2_ID,
        type: NotificationType.enum.follow_request,
        sourceActorId: ACTOR1_ID,
        followId: expectedFollowId
      })

      expect(sendNotificationAlerts).toHaveBeenCalledTimes(1)
      expect(sendNotificationAlerts).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ACTOR2_ID,
          sourceActorId: ACTOR1_ID,
          events: [
            expect.objectContaining({
              type: NotificationType.enum.follow_request,
              notificationId: notifications[0].id,
              emailContent: expect.objectContaining({
                recipientEmail: 'test2@llun.test'
              })
            })
          ]
        })
      )

      expect(await originStatus()).toBe(FollowStatus.enum.Undo)
      expect(mockPublish).toHaveBeenCalledWith({
        id: getMoveUndoJobId(oldFollow?.id as string),
        name: SEND_UNDO_FOLLOW_JOB_NAME,
        data: {
          actorId: ACTOR1_ID,
          follow: expect.objectContaining({ id: oldFollow?.id })
        }
      })

      // Retry: must stay Requested and not duplicate the notification
      await run(ACTOR1_ID, ACTOR2_ID)

      expect(follow).not.toHaveBeenCalled()
      expect(
        (await database.getFollowFromId({ followId: expectedFollowId }))?.status
      ).toBe(FollowStatus.enum.Requested)
      expect(sendNotificationAlerts).toHaveBeenCalledTimes(1)
      expect(
        await database.getNotifications({ actorId: ACTOR2_ID, limit: 10 })
      ).toHaveLength(1)
    })

    it('creates missing notification on retry when own follow row already exists without one', async () => {
      await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })
      const oldFollow = await active(ACTOR1_ID, ORIGIN)
      const ownLocalId = getMoveFollowId(oldFollow?.id as string, ACTOR2_ID)

      await database.createFollow({
        id: ownLocalId,
        actorId: ACTOR1_ID,
        targetActorId: ACTOR2_ID,
        status: FollowStatus.enum.Accepted,
        inbox: `${ACTOR1_ID}/inbox`,
        sharedInbox: 'https://llun.test/inbox'
      })

      expect(
        await database.getNotificationFromFollowId({ followId: ownLocalId })
      ).toBeNull()

      await run(ACTOR1_ID, ACTOR2_ID)

      const notification = await database.getNotificationFromFollowId({
        followId: ownLocalId
      })
      expect(notification).not.toBeNull()
      expect(notification).toMatchObject({
        actorId: ACTOR2_ID,
        type: NotificationType.enum.follow,
        sourceActorId: ACTOR1_ID,
        followId: ownLocalId
      })
      expect(sendNotificationAlerts).toHaveBeenCalledTimes(1)
    })

    it('creates missing follow_request notification on retry for silenced follower when own row already exists', async () => {
      await database.setActorSilenced({ actorId: ACTOR1_ID, silenced: true })
      await database.updateActor({ actorId: ORIGIN, movedTo: ACTOR2_ID })
      const oldFollow = await active(ACTOR1_ID, ORIGIN)
      const ownLocalId = getMoveFollowId(oldFollow?.id as string, ACTOR2_ID)

      await database.createFollow({
        id: ownLocalId,
        actorId: ACTOR1_ID,
        targetActorId: ACTOR2_ID,
        status: FollowStatus.enum.Requested,
        inbox: `${ACTOR1_ID}/inbox`,
        sharedInbox: 'https://llun.test/inbox'
      })

      await run(ACTOR1_ID, ACTOR2_ID)

      expect(follow).not.toHaveBeenCalled()
      expect(
        (await database.getFollowFromId({ followId: ownLocalId }))?.status
      ).toBe(FollowStatus.enum.Requested)

      const notification = await database.getNotificationFromFollowId({
        followId: ownLocalId
      })
      expect(notification).not.toBeNull()
      expect(notification).toMatchObject({
        actorId: ACTOR2_ID,
        type: NotificationType.enum.follow_request,
        sourceActorId: ACTOR1_ID,
        followId: ownLocalId
      })
      expect(sendNotificationAlerts).toHaveBeenCalledTimes(1)
    })
  })
})
