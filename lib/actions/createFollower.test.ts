import { acceptFollow } from '../activities'
import { Actor } from '../models/actor'
import { Sqlite3Storage } from '../storage/sqlite3'
import { testUserId } from '../stub/const'
import { MockFollowRequest } from '../stub/followRequest'
import { seedActor1 } from '../stub/seed/actor1'
import { seedStorage } from '../stub/storage'
import { createFollower } from './createFollower'

jest.mock('../activities', () => {
  const { testUserId } = jest.requireActual('../stub/const')
  return {
    acceptFollow: jest.fn(),
    getPublicProfile: jest
      .fn()
      .mockResolvedValue(
        jest
          .requireActual('../stub/person')
          .MockPerson({ id: testUserId('null') })
      )
  }
})

describe('#createFollower', () => {
  const storage = new Sqlite3Storage({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  let actor: Actor | undefined

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
    actor = await storage.getActorFromUsername({
      username: seedActor1.username
    })
  })

  afterAll(async () => {
    if (!storage) return
    await storage.destroy()
  })

  it('creates follower in database and send accept follow back', async () => {
    if (!actor) fail('Actor is required')

    const request = MockFollowRequest({
      actorId: 'https://another.network/users/friend',
      targetActorId: actor.id
    })
    const follow = await createFollower({
      storage,
      followRequest: request
    })
    expect(follow).toEqual(request)
    expect(acceptFollow).toHaveBeenCalledWith(actor, request)
  })

  it(`returns null and don't do anything`, async () => {
    const request = MockFollowRequest({
      actorId: 'https://another.network/users/friend',
      targetActorId: testUserId('notexist')
    })
    const follow = await createFollower({
      storage,
      followRequest: request
    })
    expect(follow).toBeNull()
  })
})
