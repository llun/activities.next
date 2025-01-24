import { getSQLStorage } from '../storage/sql'
import { ACTOR2_ID } from '../stub/seed/actor2'
import { ACTOR3_ID } from '../stub/seed/actor3'
import { seedStorage } from '../stub/storage'
import { MockUndoFollowRequest } from '../stub/undoRequest'
import { undoFollowRequest } from './undoFollowRequest'

jest.mock('../activities')

describe('#undoFollowRequest', () => {
  const storage = getSQLStorage({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
  })

  afterAll(async () => {
    await storage.destroy()
  })

  it('updates follow status to undo and return true', async () => {
    const totalActor3Following = await storage.getActorFollowingCount({
      actorId: ACTOR3_ID
    })
    const totalActor2Followers = await storage.getActorFollowersCount({
      actorId: ACTOR2_ID
    })
    const request = MockUndoFollowRequest({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR2_ID
    })
    expect(await undoFollowRequest({ storage, request })).toBeTrue()

    expect(
      await storage.getMastodonActorFromId({ id: ACTOR2_ID })
    ).toMatchObject({
      followers_count: totalActor2Followers - 1
    })
    expect(
      await storage.getActorFollowersCount({ actorId: ACTOR2_ID })
    ).toEqual(totalActor2Followers - 1)

    expect(
      await storage.getMastodonActorFromId({ id: ACTOR3_ID })
    ).toMatchObject({ following_count: totalActor3Following - 1 })
    expect(
      await storage.getActorFollowingCount({ actorId: ACTOR3_ID })
    ).toEqual(totalActor3Following - 1)
  })

  it('returns false when follow is not exist', async () => {
    const request = MockUndoFollowRequest({
      actorId: ACTOR3_ID,
      targetActorId: 'https://notfound.test/actor'
    })
    expect(await undoFollowRequest({ storage, request })).toBeFalse()
  })
})
