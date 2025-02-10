import { undoFollowRequest } from '@/lib/actions/undoFollowRequest'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { MockUndoFollowRequest } from '@/lib/stub/undoRequest'

jest.mock('../activities')

describe('#undoFollowRequest', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
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
})
