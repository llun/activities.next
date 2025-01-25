import { createFollower } from '@/lib/actions/createFollower'
import { acceptFollow } from '@/lib/activities'
import { Actor } from '@/lib/models/actor'
import { getSQLStorage } from '@/lib/storage/sql'
import { testUserId } from '@/lib/stub/const'
import { MockFollowRequest } from '@/lib/stub/followRequest'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedStorage } from '@/lib/stub/storage'

jest.mock('../activities')

describe('#createFollower', () => {
  const storage = getSQLStorage({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  })
  let actor: Actor

  beforeAll(async () => {
    await storage.migrate()
    await seedStorage(storage)
    actor = (await storage.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
  })

  afterAll(async () => {
    await storage.destroy()
  })

  it('creates follower in database and send accept follow back', async () => {
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
