import fetchMock from 'jest-fetch-mock'

import { createFollower } from '@/lib/actions/createFollower'
import * as actorUtils from '@/lib/actions/utils'
import { acceptFollow, rejectFollow } from '@/lib/activities'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import type { Database } from '@/lib/database/types'
import * as followNotifications from '@/lib/services/notifications/notifyLocalFollow'
import { mockRequests } from '@/lib/stub/activities'
import { testUserId } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { MockFollowRequest } from '@/lib/stub/followRequest'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { BLUESKY_BRIDGE_ACTOR_ID } from '@/lib/utils/blueskySharing'

vi.mock('@/lib/activities')
vi.mock('@/lib/activities/getActorPerson')

describe('createFollower', () => {
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

  beforeEach(() => {
    // Recording a new follower asks the follower's host for its WebFinger.
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  afterEach(() => {
    vi.clearAllMocks()
    if (getActorSettingsSpy) {
      getActorSettingsSpy.mockRestore()
    }
  })

  it('creates follower in database and send accept follow back when auto-accept is enabled', async () => {
    // Mock getActorSettings to return manuallyApprovesFollowers: false
    getActorSettingsSpy = vi
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
      expect.objectContaining({ id: actor.id }),
      'https://another.network/users/friend/inbox',
      request
    )
  })

  it('creates follower with Requested status when manual approval is enabled', async () => {
    // Mock getActorSettings to return manuallyApprovesFollowers: true
    getActorSettingsSpy = vi
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

  it('normalizes targetActorId with trailing slash', async () => {
    getActorSettingsSpy = vi
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
      actorId: 'https://another.network/users/slash-friend',
      targetActorId: `${actor.id}/`
    })
    const follow = await createFollower({
      database,
      followRequest: request
    })
    expect(follow).toEqual(request)
  })

  it('deduplicates duplicate follow requests for already requested follows', async () => {
    getActorSettingsSpy = vi
      .spyOn(database, 'getActorSettings')
      .mockResolvedValue({
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
    expect(acceptFollow).not.toHaveBeenCalled()
  })

  it('returns null if recipientActorId does not match target actor', async () => {
    const request = MockFollowRequest({
      actorId: 'https://another.network/users/intruder',
      targetActorId: actor.id
    })
    const follow = await createFollower({
      database,
      followRequest: request,
      recipientActorId: 'https://somewhere.else/users/someone-else'
    })
    expect(follow).toBeNull()
  })

  it('returns null if target actor has no privateKey (remote actor)', async () => {
    vi.spyOn(database, 'getActorFromId').mockResolvedValueOnce({
      ...actor,
      id: 'https://remote.example.com/users/cached',
      privateKey: ''
    })
    const request = MockFollowRequest({
      actorId: 'https://another.network/users/intruder',
      targetActorId: 'https://remote.example.com/users/cached'
    })
    const follow = await createFollower({
      database,
      followRequest: request
    })
    expect(follow).toBeNull()
  })

  it('accepts follow request when recipientActorId matches target actor with trailing slash', async () => {
    getActorSettingsSpy = vi
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
      actorId: 'https://another.network/users/trailing-recipient',
      targetActorId: actor.id
    })
    const follow = await createFollower({
      database,
      followRequest: request,
      recipientActorId: `${actor.id}/`
    })
    expect(follow).toEqual(request)
  })

  it('rejects the follow and creates nothing when the target has moved', async () => {
    await database.updateActor({
      actorId: actor.id,
      movedTo: 'https://newhome.test/users/moved'
    })
    try {
      const request = MockFollowRequest({
        actorId: 'https://another.network/users/moved-follower',
        targetActorId: actor.id
      })
      const result = await createFollower({ database, followRequest: request })

      expect(result).toEqual(request)
      expect(rejectFollow).toHaveBeenCalledTimes(1)
      expect(acceptFollow).not.toHaveBeenCalled()
      await expect(
        database.getAcceptedOrRequestedFollow({
          actorId: 'https://another.network/users/moved-follower',
          targetActorId: actor.id
        })
      ).resolves.toBeNull()
    } finally {
      await database.updateActor({ actorId: actor.id, movedTo: null })
    }
  })
})

describe('locked profile bridge follow-back', () => {
  const target = {
    id: 'https://personal.example/users/alice',
    privateKey: 'key'
  } as Actor
  const bot = {
    id: BLUESKY_BRIDGE_ACTOR_ID,
    username: 'bsky.brid.gy',
    domain: 'bsky.brid.gy',
    inboxUrl: `${BLUESKY_BRIDGE_ACTOR_ID}/inbox`
  } as Actor
  const database = {
    getActorFromId: vi.fn(),
    isEitherBlocking: vi.fn(),
    getActorSettings: vi.fn(),
    getAcceptedOrRequestedFollow: vi.fn(),
    createFollow: vi.fn(),
    updateFollowStatus: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    database.getActorFromId.mockResolvedValue(target)
    database.isEitherBlocking.mockResolvedValue(false)
    database.getActorSettings.mockResolvedValue({
      manuallyApprovesFollowers: true
    })
    database.getAcceptedOrRequestedFollow.mockReset()
    database.createFollow.mockImplementation(async (input) => ({
      ...input,
      id: 'bridge-follow'
    }))
    vi.spyOn(actorUtils, 'recordActorIfNeeded').mockResolvedValue(bot)
    vi.spyOn(followNotifications, 'notifyLocalFollow').mockResolvedValue(null)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['Requested', 'Accepted'] as const)(
    'accepts a locked profile’s bridge follow-back while sharing is %s',
    async (status) => {
      database.getAcceptedOrRequestedFollow.mockImplementation(
        async ({ actorId }) => (actorId === target.id ? { status } : null)
      )
      const followRequest = MockFollowRequest({
        actorId: bot.id,
        targetActorId: target.id
      })
      await createFollower({
        database: database as unknown as Database,
        followRequest
      })
      expect(database.createFollow).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: bot.id,
          targetActorId: target.id,
          status: 'Accepted'
        })
      )
      expect(acceptFollow).toHaveBeenCalledWith(
        target,
        bot.inboxUrl,
        followRequest
      )
      expect(followNotifications.notifyLocalFollow).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'follow' })
      )
    }
  )

  it('keeps the bridge requested on a locked profile when sharing is off', async () => {
    const followRequest = MockFollowRequest({
      actorId: bot.id,
      targetActorId: target.id
    })
    await createFollower({
      database: database as unknown as Database,
      followRequest
    })
    expect(database.createFollow).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Requested' })
    )
    expect(acceptFollow).not.toHaveBeenCalled()
    expect(followNotifications.notifyLocalFollow).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'follow_request' })
    )
  })

  it('accepts a retried pending bridge follow-back after sharing turns on', async () => {
    database.getAcceptedOrRequestedFollow.mockImplementation(
      async ({ actorId }) =>
        actorId === target.id
          ? { status: 'Requested' }
          : { id: 'pending', status: 'Requested' }
    )
    const followRequest = MockFollowRequest({
      actorId: bot.id,
      targetActorId: target.id
    })
    await createFollower({
      database: database as unknown as Database,
      followRequest
    })
    expect(database.updateFollowStatus).toHaveBeenCalledWith({
      followId: 'pending',
      status: 'Accepted'
    })
    expect(acceptFollow).toHaveBeenCalledWith(
      target,
      bot.inboxUrl,
      followRequest
    )
    expect(database.createFollow).not.toHaveBeenCalled()
  })

  it('does not auto-accept another account on the bridge domain', async () => {
    vi.mocked(actorUtils.recordActorIfNeeded).mockResolvedValue({
      ...bot,
      id: 'https://bsky.brid.gy/ap/another'
    })
    database.getAcceptedOrRequestedFollow.mockResolvedValue(null)
    await createFollower({
      database: database as unknown as Database,
      followRequest: MockFollowRequest({
        actorId: 'https://bsky.brid.gy/ap/another',
        targetActorId: target.id
      })
    })
    expect(database.createFollow).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'Requested' })
    )
    expect(acceptFollow).not.toHaveBeenCalled()
  })

  it('rejects a blocked bridge before the auto-accept exception', async () => {
    database.isEitherBlocking.mockResolvedValue(true)
    await createFollower({
      database: database as unknown as Database,
      followRequest: MockFollowRequest({
        actorId: bot.id,
        targetActorId: target.id
      })
    })
    expect(rejectFollow).toHaveBeenCalled()
    expect(database.createFollow).not.toHaveBeenCalled()
  })
})
