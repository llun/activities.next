import { acceptFollow } from '../activities'
import { Actor } from '../models/actor'
import { SqlStorage } from '../storage/sql'
import { testUserId } from '../stub/const'
import { MockFollowRequest } from '../stub/followRequest'
import { seedActor1 } from '../stub/seed/actor1'
import { seedStorage } from '../stub/storage'
import { createFollower } from './createFollower'

jest.mock('../activities')

describe('#createFollower', () => {
  const storage = new SqlStorage({
    client: 'better-sqlite3',
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
      username: seedActor1.username,
      domain: seedActor1.domain
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

    const followingActor = await storage.getActorFromId({
      id: 'https://another.network/users/friend'
    })
    expect(followingActor).toBeDefined()
    expect(acceptFollow).toHaveBeenCalledWith(
      actor,
      'https://another.network/users/friend/inbox',
      request
    )
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
