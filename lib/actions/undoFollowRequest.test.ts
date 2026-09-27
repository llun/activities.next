import { undoFollowRequest } from '@/lib/actions/undoFollowRequest'
import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { ACTOR5_ID } from '@/lib/stub/seed/actor5'
import { MockUndoFollowRequest } from '@/lib/stub/undoRequest'
import { FollowStatus } from '@/lib/types/domain/follow'

vi.mock('@/lib/activities')

describe('undoFollowRequest', () => {
  const { database, instance } = getTestSQLDatabaseWithInstance()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(async () => {
    const existing = await database.getAcceptedOrRequestedFollow({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR2_ID
    })
    if (!existing) {
      const follow = await instance('follows')
        .where({
          actorId: ACTOR3_ID,
          targetActorId: ACTOR2_ID
        })
        .first()
      if (follow) {
        await database.updateFollowStatus({
          followId: follow.id,
          status: FollowStatus.enum.Accepted
        })
      }
    }
  })

  it('updates follow status to undo and return true', async () => {
    const totalActor3Following = await database.getActorFollowingCount({
      actorId: ACTOR3_ID
    })
    const totalActor2Followers = await database.getActorFollowersCount({
      actorId: ACTOR2_ID
    })
    const request = MockUndoFollowRequest({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR2_ID
    })
    expect(await undoFollowRequest({ database, request })).toBeTrue()

    expect(
      await database.getMastodonActorFromId({ id: ACTOR2_ID })
    ).toMatchObject({
      followers_count: totalActor2Followers - 1
    })
    expect(
      await database.getActorFollowersCount({ actorId: ACTOR2_ID })
    ).toEqual(totalActor2Followers - 1)

    expect(
      await database.getMastodonActorFromId({ id: ACTOR3_ID })
    ).toMatchObject({ following_count: totalActor3Following - 1 })
    expect(
      await database.getActorFollowingCount({ actorId: ACTOR3_ID })
    ).toEqual(totalActor3Following - 1)
  })

  it('returns false when follow is not exist', async () => {
    const request = MockUndoFollowRequest({
      actorId: ACTOR3_ID,
      targetActorId: 'https://notfound.test/actor'
    })
    expect(await undoFollowRequest({ database, request })).toBeFalse()
  })

  it('handles idempotent retries when follow was already undone', async () => {
    const follow = await database.createFollow({
      actorId: ACTOR4_ID,
      targetActorId: ACTOR5_ID,
      status: FollowStatus.enum.Accepted,
      inbox: 'https://llun.test/users/test4/inbox',
      sharedInbox: 'https://llun.test/inbox'
    })

    const request = MockUndoFollowRequest({
      actorId: ACTOR4_ID,
      targetActorId: ACTOR5_ID,
      followId: `https://llun.test/${follow.id}`
    })

    // First undo
    expect(await undoFollowRequest({ database, request })).toBeTrue()
    // Second undo (retry) - idempotent
    expect(await undoFollowRequest({ database, request })).toBeTrue()
  })

  it('handles trailing slashes in actor or targetActor URIs', async () => {
    await database.createFollow({
      actorId: ACTOR5_ID,
      targetActorId: ACTOR4_ID,
      status: FollowStatus.enum.Accepted,
      inbox: 'https://llun.test/users/test5/inbox',
      sharedInbox: 'https://llun.test/inbox'
    })

    const request = MockUndoFollowRequest({
      actorId: `${ACTOR5_ID}/`,
      targetActorId: `${ACTOR4_ID}/`
    })

    expect(await undoFollowRequest({ database, request })).toBeTrue()
  })
})
