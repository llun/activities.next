import { createFollower } from '@/lib/actions/createFollower'
import { acceptFollow } from '@/lib/activities'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Actor } from '@/lib/models/actor'
import { FollowStatus } from '@/lib/models/follow'
import { testUserId } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { MockFollowRequest } from '@/lib/stub/followRequest'
import { seedActor1 } from '@/lib/stub/seed/actor1'

jest.mock('../activities')
jest.mock('../activities/requests/getActorPerson')

describe('#createFollower', () => {
  const database = getTestSQLDatabase()
  let actor: Actor
  let getActorSettingsSpy: jest.SpyInstance

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

  afterEach(() => {
    if (getActorSettingsSpy) {
      getActorSettingsSpy.mockRestore()
    }
  })

  it('creates follower in database and send accept follow back when auto-accept is enabled', async () => {
    // Mock getActorSettings to return manuallyApprovesFollowers: false
    getActorSettingsSpy = jest
      .spyOn(database, 'getActorSettings')
      .mockResolvedValueOnce({
        iconUrl: undefined,
        headerImageUrl: undefined,
        followersUrl: actor.followersUrl,
        inboxUrl: actor.inboxUrl,
        sharedInboxUrl: actor.sharedInboxUrl,
        manuallyApprovesFollowers: false
      })

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

  it('creates follower with Requested status when manual approval is enabled', async () => {
    // Mock getActorSettings to return manuallyApprovesFollowers: true
    getActorSettingsSpy = jest
      .spyOn(database, 'getActorSettings')
      .mockResolvedValueOnce({
        iconUrl: undefined,
        headerImageUrl: undefined,
        followersUrl: actor.followersUrl,
        inboxUrl: actor.inboxUrl,
        sharedInboxUrl: actor.sharedInboxUrl,
        manuallyApprovesFollowers: true
      })

    const request = MockFollowRequest({
      actorId: 'https://another.network/users/friend2',
      targetActorId: actor.id
    })
    const follow = await createFollower({
      database,
      followRequest: request
    })
    expect(follow).toEqual(request)

    const followingActor = await database.getActorFromId({
      id: 'https://another.network/users/friend2'
    })
    expect(followingActor).toBeDefined()

    // Verify follow was created with Requested status
    const followRecord = await database.getAcceptedOrRequestedFollow({
      actorId: 'https://another.network/users/friend2',
      targetActorId: actor.id
    })
    expect(followRecord).toBeDefined()
    expect(followRecord?.status).toBe(FollowStatus.enum.Requested)

    // acceptFollow should NOT be called for manual approval
    expect(acceptFollow).not.toHaveBeenCalledWith(
      actor,
      'https://another.network/users/friend2/inbox',
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
