import crypto from 'crypto'

import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { Follow, FollowStatus } from '@/lib/models/follow'
import { TEST_SHARED_INBOX, seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('FollowDatabase', () => {
  const { actors, follows: seedFollows, externalActors } = DatabaseSeed
  const primaryActorId = actors.primary.id
  const replyAuthorId = actors.replyAuthor.id
  const pollAuthorId = actors.pollAuthor.id
  const followRequesterId = actors.followRequester.id
  const emptyActorId = actors.empty.id
  const extraActorId = actors.extra.id
  const externalFollowersUrl = externalActors.primary.followersUrl
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    const createLocalActor = async () => {
      const suffix = crypto.randomUUID().slice(0, 8)
      const username = `follow-${suffix}`
      await database.createAccount({
        email: `${username}@${actors.primary.domain}`,
        username,
        passwordHash: 'password_hash',
        domain: actors.primary.domain,
        privateKey: `privateKey-${suffix}`,
        publicKey: `publicKey-${suffix}`
      })

      return `https://${actors.primary.domain}/users/${username}`
    }

    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    it('returns empty followers and following for empty actor', async () => {
      const actor = await database.getMastodonActorFromId({ id: emptyActorId })
      expect(actor).toMatchObject({
        followers_count: 0,
        following_count: 0
      })
      expect(
        await database.getActorFollowersCount({ actorId: emptyActorId })
      ).toEqual(0)
      expect(
        await database.getActorFollowingCount({ actorId: emptyActorId })
      ).toEqual(0)
      expect(
        await database.getFollowersInbox({ targetActorId: emptyActorId })
      ).toEqual([])
    })

    it('returns followers and following count in mastodon actor', async () => {
      const actor = await database.getMastodonActorFromId({
        id: primaryActorId
      })
      expect(actor).toMatchObject({
        followers_count: 1,
        following_count: 2
      })
      expect(
        await database.getActorFollowersCount({ actorId: primaryActorId })
      ).toEqual(1)
      expect(
        await database.getActorFollowingCount({ actorId: primaryActorId })
      ).toEqual(2)
      expect(
        await database.getFollowersInbox({ targetActorId: primaryActorId })
      ).toEqual(['https://somewhere.test/inbox'])
    })

    describe('isCurrentActorFollowing', () => {
      it('returns false if current actor is not following target actor', async () => {
        expect(
          await database.isCurrentActorFollowing({
            currentActorId: pollAuthorId,
            followingActorId: primaryActorId
          })
        ).toEqual(false)
      })

      it('returns false if current actor is requested but not accepted yet', async () => {
        expect(
          await database.isCurrentActorFollowing({
            currentActorId: followRequesterId,
            followingActorId: primaryActorId
          })
        ).toEqual(false)
      })

      it('returns true if current actor is following target actor', async () => {
        expect(
          await database.isCurrentActorFollowing({
            currentActorId: 'https://somewhere.test/actors/friend',
            followingActorId: primaryActorId
          })
        ).toEqual(true)
      })
    })

    describe('getAcceptedOrRequestedFollow', () => {
      it('returns accpeted follow', async () => {
        const follow = await database.getAcceptedOrRequestedFollow({
          actorId: 'https://somewhere.test/actors/friend',
          targetActorId: primaryActorId
        })
        expect(follow).toMatchObject({
          actorId: 'https://somewhere.test/actors/friend',
          targetActorId: primaryActorId,
          status: FollowStatus.enum.Accepted
        })
      })

      it('returns requested follow', async () => {
        const follow = await database.getAcceptedOrRequestedFollow({
          actorId: followRequesterId,
          targetActorId: primaryActorId
        })
        expect(follow).toMatchObject({
          actorId: followRequesterId,
          targetActorId: primaryActorId,
          status: FollowStatus.enum.Requested
        })
      })

      it('returns null if follow not found', async () => {
        const follow = await database.getAcceptedOrRequestedFollow({
          actorId: primaryActorId,
          targetActorId: followRequesterId
        })
        expect(follow).toBeNull()
      })
    })

    describe('getFollowFromId', () => {
      it('returns follow by id', async () => {
        const pendingFollow = await database.getAcceptedOrRequestedFollow({
          actorId: seedFollows.followRequesterPending.actorId,
          targetActorId: seedFollows.followRequesterPending.targetActorId
        })
        expect(pendingFollow).not.toBeNull()

        const follow = await database.getFollowFromId({
          followId: (pendingFollow as Follow).id
        })
        expect(follow).toMatchObject({
          id: (pendingFollow as Follow).id,
          actorId: seedFollows.followRequesterPending.actorId,
          targetActorId: seedFollows.followRequesterPending.targetActorId,
          status: FollowStatus.enum.Requested
        })
      })

      it('returns null if follow id does not exist', async () => {
        const follow = await database.getFollowFromId({
          followId: 'missing-follow-id'
        })
        expect(follow).toBeNull()
      })
    })

    describe('getLocalFollowsFromInboxUrl', () => {
      it('returns local follows from inbox url', async () => {
        const follows = await database.getLocalFollowsFromInboxUrl({
          followerInboxUrl: 'https://somewhere.test/inbox/friend',
          targetActorId: primaryActorId
        })
        expect(follows).toHaveLength(1)
        expect(follows[0]).toMatchObject({
          actorId: 'https://somewhere.test/actors/friend',
          targetActorId: primaryActorId,
          status: FollowStatus.enum.Accepted
        })
      })

      it('returns empty array if inbox url not found', async () => {
        const follows = await database.getLocalFollowsFromInboxUrl({
          followerInboxUrl: 'https://somewhere.test/inbox/unknown',
          targetActorId: primaryActorId
        })
        expect(follows).toHaveLength(0)
      })
    })

    describe('getLocalFollowersForActorId', () => {
      it('returns local followers for internal actor', async () => {
        const targetActorId = await createLocalActor()
        await database.createFollow({
          actorId: extraActorId,
          targetActorId,
          inbox: `${extraActorId}/inbox`,
          sharedInbox: TEST_SHARED_INBOX,
          status: FollowStatus.enum.Accepted
        })

        const follows = await database.getLocalFollowersForActorId({
          targetActorId
        })
        expect(follows).toHaveLength(1)
        expect(follows[0].actorId).toBe(extraActorId)
      })

      it('returns all followers for external actor', async () => {
        const follows = await database.getLocalFollowersForActorId({
          targetActorId: externalActors.primary.id
        })
        expect(follows).toHaveLength(1)
        expect(follows[0]).toMatchObject({
          actorId: primaryActorId,
          targetActorId: externalActors.primary.id
        })
      })
    })

    describe('getFollowersInbox', () => {
      it('returns all accepted followers inbox urls', async () => {
        const inboxes = await database.getFollowersInbox({
          targetActorId: primaryActorId
        })
        expect(inboxes).toEqual(['https://somewhere.test/inbox'])
      })
    })

    describe('getLocalActorsFromFollowerUrl', () => {
      it('returns only actors with accounts from follower ids for external actor', async () => {
        const actors = await database.getLocalActorsFromFollowerUrl({
          followerUrl: externalFollowersUrl
        })
        expect(actors).toHaveLength(1)
        expect(actors[0]).toMatchObject({
          id: primaryActorId
        })
      })

      it('returns only accepted actors with accounts from follower ids for internal actor', async () => {
        const actors = await database.getLocalActorsFromFollowerUrl({
          followerUrl: `${replyAuthorId}/followers`
        })
        expect(actors).toHaveLength(1)
        expect(actors[0]).toMatchObject({
          id: pollAuthorId
        })
      })
    })

    describe('getFollowing', () => {
      it('returns following with cursor pagination', async () => {
        const following = await database.getFollowing({
          actorId: primaryActorId,
          limit: 10
        })
        expect(following).toHaveLength(2)

        const older = await database.getFollowing({
          actorId: primaryActorId,
          limit: 10,
          maxId: following[0].id
        })
        expect(older).toHaveLength(1)
        expect(older[0].id).toBe(following[1].id)

        const newer = await database.getFollowing({
          actorId: primaryActorId,
          limit: 10,
          minId: following[1].id
        })
        expect(newer).toHaveLength(1)
        expect(newer[0].id).toBe(following[0].id)
      })
    })

    describe('getFollowers', () => {
      it('returns followers with cursor pagination', async () => {
        const targetActorId = await createLocalActor()
        const followerA = await createLocalActor()
        const followerB = await createLocalActor()

        await database.createFollow({
          actorId: followerA,
          targetActorId,
          inbox: `${followerA}/inbox`,
          sharedInbox: TEST_SHARED_INBOX,
          status: FollowStatus.enum.Accepted
        })
        await database.createFollow({
          actorId: followerB,
          targetActorId,
          inbox: `${followerB}/inbox`,
          sharedInbox: TEST_SHARED_INBOX,
          status: FollowStatus.enum.Accepted
        })

        const followers = await database.getFollowers({
          targetActorId,
          limit: 10
        })
        expect(followers).toHaveLength(2)

        const older = await database.getFollowers({
          targetActorId,
          limit: 10,
          maxId: followers[0].id
        })
        expect(older).toHaveLength(1)
        expect(older[0].id).toBe(followers[1].id)

        const newer = await database.getFollowers({
          targetActorId,
          limit: 10,
          minId: followers[1].id
        })
        expect(newer).toHaveLength(1)
        expect(newer[0].id).toBe(followers[0].id)
      })
    })

    describe('getFollowRequests', () => {
      it('returns follow requests and count', async () => {
        const requests = await database.getFollowRequests({
          targetActorId: primaryActorId,
          limit: 10
        })
        expect(requests).toHaveLength(1)
        expect(requests[0]).toMatchObject({
          actorId: followRequesterId,
          targetActorId: primaryActorId,
          status: FollowStatus.enum.Requested
        })

        const count = await database.getFollowRequestsCount({
          targetActorId: primaryActorId
        })
        expect(count).toBe(1)
      })
    })

    describe('createFollow', () => {
      it('creates follow with requested status does not increase following and follower count', async () => {
        await database.createFollow({
          actorId: replyAuthorId,
          targetActorId: primaryActorId,
          inbox: `${replyAuthorId}/inbox`,
          sharedInbox: TEST_SHARED_INBOX,
          status: FollowStatus.enum.Requested
        })
        expect(
          await database.getMastodonActorFromId({ id: primaryActorId })
        ).toMatchObject({
          followers_count: 1
        })
        expect(
          await database.getActorFollowersCount({ actorId: primaryActorId })
        ).toEqual(1)
        expect(
          await database.getMastodonActorFromId({ id: replyAuthorId })
        ).toMatchObject({
          following_count: 1
        })
        expect(
          await database.getActorFollowingCount({ actorId: replyAuthorId })
        ).toEqual(1)
      })

      it('creates follow with accepted status and increase following and follower count', async () => {
        await database.createFollow({
          actorId: pollAuthorId,
          targetActorId: primaryActorId,
          inbox: `${pollAuthorId}/inbox`,
          sharedInbox: TEST_SHARED_INBOX,
          status: FollowStatus.enum.Accepted
        })
        expect(
          await database.getMastodonActorFromId({ id: primaryActorId })
        ).toMatchObject({
          followers_count: 2
        })
        expect(
          await database.getActorFollowersCount({ actorId: primaryActorId })
        ).toEqual(2)
        expect(
          await database.getMastodonActorFromId({ id: pollAuthorId })
        ).toMatchObject({
          following_count: 3
        })
        expect(
          await database.getActorFollowingCount({ actorId: pollAuthorId })
        ).toEqual(3)
      })
    })

    describe('updateFollow', () => {
      it('reduce following and follower when actor undo', async () => {
        const beforeUndoActorFollowingCount =
          await database.getActorFollowingCount({ actorId: pollAuthorId })
        const beforeUndoTargetActorFollowersCount =
          await database.getActorFollowersCount({ actorId: replyAuthorId })

        const acceptedFollow = await database.getAcceptedOrRequestedFollow({
          actorId: pollAuthorId,
          targetActorId: replyAuthorId
        })
        await database.updateFollowStatus({
          followId: (acceptedFollow as Follow).id,
          status: FollowStatus.enum.Undo
        })
        expect(
          await database.getMastodonActorFromId({ id: replyAuthorId })
        ).toMatchObject({
          followers_count: beforeUndoTargetActorFollowersCount - 1
        })
        expect(
          await database.getActorFollowersCount({ actorId: replyAuthorId })
        ).toEqual(beforeUndoTargetActorFollowersCount - 1)

        expect(
          await database.getMastodonActorFromId({ id: pollAuthorId })
        ).toMatchObject({
          following_count: beforeUndoActorFollowingCount - 1
        })
        expect(
          await database.getActorFollowingCount({ actorId: pollAuthorId })
        ).toEqual(beforeUndoActorFollowingCount - 1)
      })

      it('increase following and follower when actor accepted', async () => {
        const beforeUndoActorFollowingCount =
          await database.getActorFollowingCount({ actorId: followRequesterId })
        const beforeUndoTargetActorFollowersCount =
          await database.getActorFollowersCount({ actorId: primaryActorId })
        const acceptedFollow = await database.getAcceptedOrRequestedFollow({
          actorId: followRequesterId,
          targetActorId: primaryActorId
        })
        await database.updateFollowStatus({
          followId: (acceptedFollow as Follow).id,
          status: FollowStatus.enum.Accepted
        })
        expect(
          await database.getMastodonActorFromId({ id: primaryActorId })
        ).toMatchObject({
          followers_count: beforeUndoTargetActorFollowersCount + 1
        })
        expect(
          await database.getActorFollowersCount({ actorId: primaryActorId })
        ).toEqual(beforeUndoTargetActorFollowersCount + 1)

        expect(
          await database.getMastodonActorFromId({ id: followRequesterId })
        ).toMatchObject({
          following_count: beforeUndoActorFollowingCount + 1
        })
        expect(
          await database.getActorFollowingCount({ actorId: followRequesterId })
        ).toEqual(beforeUndoActorFollowingCount + 1)
      })
    })
  })
})
