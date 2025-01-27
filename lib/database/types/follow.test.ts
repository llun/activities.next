import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { Follow, FollowStatus } from '@/lib/models/follow'
import { TEST_SHARED_INBOX, seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR5_ID } from '@/lib/stub/seed/actor5'
import { ACTOR6_ID } from '@/lib/stub/seed/actor6'
import { EXTERNAL_ACTOR1_FOLLOWERS } from '@/lib/stub/seed/external1'

describe('FollowDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    it('returns empty followers and following for empty actor', async () => {
      const actor = await database.getMastodonActorFromId({ id: ACTOR6_ID })
      expect(actor).toMatchObject({
        followers_count: 0,
        following_count: 0
      })
      expect(
        await database.getActorFollowersCount({ actorId: ACTOR6_ID })
      ).toEqual(0)
      expect(
        await database.getActorFollowingCount({ actorId: ACTOR6_ID })
      ).toEqual(0)
      expect(
        await database.getFollowersInbox({ targetActorId: ACTOR6_ID })
      ).toEqual([])
    })

    it('returns followers and following count in mastodon actor', async () => {
      const actor = await database.getMastodonActorFromId({ id: ACTOR1_ID })
      expect(actor).toMatchObject({
        followers_count: 1,
        following_count: 2
      })
      expect(
        await database.getActorFollowersCount({ actorId: ACTOR1_ID })
      ).toEqual(1)
      expect(
        await database.getActorFollowingCount({ actorId: ACTOR1_ID })
      ).toEqual(2)
      expect(
        await database.getFollowersInbox({ targetActorId: ACTOR1_ID })
      ).toEqual(['https://somewhere.test/inbox'])
    })

    describe('isCurrentActorFollowing', () => {
      it('returns false if current actor is not following target actor', async () => {
        expect(
          await database.isCurrentActorFollowing({
            currentActorId: ACTOR3_ID,
            followingActorId: ACTOR1_ID
          })
        ).toEqual(false)
      })

      it('returns false if current actor is requested but not accepted yet', async () => {
        expect(
          await database.isCurrentActorFollowing({
            currentActorId: ACTOR5_ID,
            followingActorId: ACTOR1_ID
          })
        ).toEqual(false)
      })

      it('returns true if current actor is following target actor', async () => {
        expect(
          await database.isCurrentActorFollowing({
            currentActorId: 'https://somewhere.test/actors/friend',
            followingActorId: ACTOR1_ID
          })
        ).toEqual(true)
      })
    })

    describe('getAcceptedOrRequestedFollow', () => {
      it('returns accpeted follow', async () => {
        const follow = await database.getAcceptedOrRequestedFollow({
          actorId: 'https://somewhere.test/actors/friend',
          targetActorId: ACTOR1_ID
        })
        expect(follow).toMatchObject({
          actorId: 'https://somewhere.test/actors/friend',
          targetActorId: ACTOR1_ID,
          status: FollowStatus.enum.Accepted
        })
      })

      it('returns requested follow', async () => {
        const follow = await database.getAcceptedOrRequestedFollow({
          actorId: ACTOR5_ID,
          targetActorId: ACTOR1_ID
        })
        expect(follow).toMatchObject({
          actorId: ACTOR5_ID,
          targetActorId: ACTOR1_ID,
          status: FollowStatus.enum.Requested
        })
      })

      it('returns null if follow not found', async () => {
        const follow = await database.getAcceptedOrRequestedFollow({
          actorId: ACTOR1_ID,
          targetActorId: ACTOR5_ID
        })
        expect(follow).toBeUndefined()
      })
    })

    describe('getLocalFollowsFromInboxUrl', () => {
      it('returns local follows from inbox url', async () => {
        const follows = await database.getLocalFollowsFromInboxUrl({
          followerInboxUrl: 'https://somewhere.test/inbox/friend',
          targetActorId: ACTOR1_ID
        })
        expect(follows).toHaveLength(1)
        expect(follows[0]).toMatchObject({
          actorId: 'https://somewhere.test/actors/friend',
          targetActorId: ACTOR1_ID,
          status: FollowStatus.enum.Accepted
        })
      })

      it('returns empty array if inbox url not found', async () => {
        const follows = await database.getLocalFollowsFromInboxUrl({
          followerInboxUrl: 'https://somewhere.test/inbox/unknown',
          targetActorId: ACTOR1_ID
        })
        expect(follows).toHaveLength(0)
      })
    })

    describe('getFollowersInbox', () => {
      it('returns all accepted followers inbox urls', async () => {
        const inboxes = await database.getFollowersInbox({
          targetActorId: ACTOR1_ID
        })
        expect(inboxes).toEqual(['https://somewhere.test/inbox'])
      })
    })

    describe('getLocalActorsFromFollowerUrl', () => {
      it('returns only actors with accounts from follower ids for external actor', async () => {
        const actors = await database.getLocalActorsFromFollowerUrl({
          followerUrl: EXTERNAL_ACTOR1_FOLLOWERS
        })
        expect(actors).toHaveLength(1)
        expect(actors[0]).toMatchObject({
          id: ACTOR1_ID
        })
      })

      it('returns only accepted actors with accounts from follower ids for internal actor', async () => {
        const actors = await database.getLocalActorsFromFollowerUrl({
          followerUrl: `${ACTOR2_ID}/followers`
        })
        expect(actors).toHaveLength(1)
        expect(actors[0]).toMatchObject({
          id: ACTOR3_ID
        })
      })
    })

    describe('createFollow', () => {
      it('creates follow with requested status does not increase following and follower count', async () => {
        await database.createFollow({
          actorId: ACTOR2_ID,
          targetActorId: ACTOR1_ID,
          inbox: `${ACTOR2_ID}/inbox`,
          sharedInbox: TEST_SHARED_INBOX,
          status: FollowStatus.enum.Requested
        })
        expect(
          await database.getMastodonActorFromId({ id: ACTOR1_ID })
        ).toMatchObject({
          followers_count: 1
        })
        expect(
          await database.getActorFollowersCount({ actorId: ACTOR1_ID })
        ).toEqual(1)
        expect(
          await database.getMastodonActorFromId({ id: ACTOR2_ID })
        ).toMatchObject({
          following_count: 1
        })
        expect(
          await database.getActorFollowingCount({ actorId: ACTOR2_ID })
        ).toEqual(1)
      })

      it('creates follow with accepted status and increase following and follower count', async () => {
        await database.createFollow({
          actorId: ACTOR3_ID,
          targetActorId: ACTOR1_ID,
          inbox: `${ACTOR3_ID}/inbox`,
          sharedInbox: TEST_SHARED_INBOX,
          status: FollowStatus.enum.Accepted
        })
        expect(
          await database.getMastodonActorFromId({ id: ACTOR1_ID })
        ).toMatchObject({
          followers_count: 2
        })
        expect(
          await database.getActorFollowersCount({ actorId: ACTOR1_ID })
        ).toEqual(2)
        expect(
          await database.getMastodonActorFromId({ id: ACTOR3_ID })
        ).toMatchObject({
          following_count: 3
        })
        expect(
          await database.getActorFollowingCount({ actorId: ACTOR3_ID })
        ).toEqual(3)
      })
    })

    describe('updateFollow', () => {
      it('reduce following and follower when actor undo', async () => {
        const beforeUndoActorFollowingCount =
          await database.getActorFollowingCount({ actorId: ACTOR3_ID })
        const beforeUndoTargetActorFollowersCount =
          await database.getActorFollowersCount({ actorId: ACTOR2_ID })

        const acceptedFollow = await database.getAcceptedOrRequestedFollow({
          actorId: ACTOR3_ID,
          targetActorId: ACTOR2_ID
        })
        await database.updateFollowStatus({
          followId: (acceptedFollow as Follow).id,
          status: FollowStatus.enum.Undo
        })
        expect(
          await database.getMastodonActorFromId({ id: ACTOR2_ID })
        ).toMatchObject({
          followers_count: beforeUndoTargetActorFollowersCount - 1
        })
        expect(
          await database.getActorFollowersCount({ actorId: ACTOR2_ID })
        ).toEqual(beforeUndoTargetActorFollowersCount - 1)

        expect(
          await database.getMastodonActorFromId({ id: ACTOR3_ID })
        ).toMatchObject({
          following_count: beforeUndoActorFollowingCount - 1
        })
        expect(
          await database.getActorFollowingCount({ actorId: ACTOR3_ID })
        ).toEqual(beforeUndoActorFollowingCount - 1)
      })

      it('increase following and follower when actor accepted', async () => {
        const beforeUndoActorFollowingCount =
          await database.getActorFollowingCount({ actorId: ACTOR5_ID })
        const beforeUndoTargetActorFollowersCount =
          await database.getActorFollowersCount({ actorId: ACTOR1_ID })
        const acceptedFollow = await database.getAcceptedOrRequestedFollow({
          actorId: ACTOR5_ID,
          targetActorId: ACTOR1_ID
        })
        await database.updateFollowStatus({
          followId: (acceptedFollow as Follow).id,
          status: FollowStatus.enum.Accepted
        })
        expect(
          await database.getMastodonActorFromId({ id: ACTOR1_ID })
        ).toMatchObject({
          followers_count: beforeUndoTargetActorFollowersCount + 1
        })
        expect(
          await database.getActorFollowersCount({ actorId: ACTOR1_ID })
        ).toEqual(beforeUndoTargetActorFollowersCount + 1)

        expect(
          await database.getMastodonActorFromId({ id: ACTOR5_ID })
        ).toMatchObject({
          following_count: beforeUndoActorFollowingCount + 1
        })
        expect(
          await database.getActorFollowingCount({ actorId: ACTOR5_ID })
        ).toEqual(beforeUndoActorFollowingCount + 1)
      })
    })
  })
})
