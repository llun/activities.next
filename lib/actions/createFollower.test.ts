import { createFollower } from '@/lib/actions/createFollower'
import { acceptFollow } from '@/lib/activities'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Actor } from '@/lib/models/actor'
import { testUserId } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { MockFollowRequest } from '@/lib/stub/followRequest'
import { seedActor1 } from '@/lib/stub/seed/actor1'

jest.mock('../activities')
jest.mock('../activities/requests/getActorPerson')

describe('#createFollower', () => {
  const database = getTestSQLDatabase()
  let actor: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('creates follower in database and send accept follow back', async () => {
    const request = MockFollowRequest({
      actorId: 'https://another.network/users/friend',
      targetActorId: actor.id
    })
    const follow = await createFollower({
      database,
      followRequest: request
    })
    expect(follow).toEqual(request)

    const followingActor = await database.getActorFromId({
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
      database,
      followRequest: request
    })
    expect(follow).toBeNull()
  })
})
