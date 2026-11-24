import { createActor } from '@/lib/database/domains/actor/writes'
import { upsertBlueskyActor } from '@/lib/database/domains/bluesky/queries'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { getQueueJobById } from '@/lib/database/testing/fixtures'
import { blueskyActorId, blueskyPostId } from '@/lib/services/bluesky/records'
import { Timeline } from '@/lib/services/timelines/types'
import type { Status } from '@/lib/types/domain/status'

vi.mock('@/lib/database/domains/actor/writes', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/database/domains/actor/writes')>()
  return { ...actual, createActor: vi.fn(actual.createActor) }
})

describe('Bluesky', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  const networkOf = async (table: 'actors' | 'statuses', id: string) =>
    (
      await testDb.db
        .selectFrom(table)
        .select('network')
        .where('id', '=', id)
        .executeTakeFirst()
    )?.network

  describe('upsertBlueskyActor', () => {
    it('creates a Bluesky actor with its handle as acct', async () => {
      const actorId = await database.upsertBlueskyActor({
        did: 'did:plc:alice',
        handle: 'Alice.bsky.social',
        name: 'Alice',
        summary: 'Hi',
        iconUrl: 'https://cdn.bsky.app/avatar.jpg',
        headerImageUrl: null,
        followersCount: 10,
        followingCount: 2,
        postsCount: 7
      })
      expect(actorId).toBe(blueskyActorId('did:plc:alice'))
      expect(await networkOf('actors', actorId as string)).toBe('bluesky')

      const account = await database.getMastodonActorFromId({
        id: actorId as string
      })
      expect(account).toMatchObject({
        acct: 'alice.bsky.social@bsky.app',
        // Anyone can follow a Bluesky account.
        locked: false,
        display_name: 'Alice',
        avatar: 'https://cdn.bsky.app/avatar.jpg',
        followers_count: 10,
        following_count: 2,
        statuses_count: 7
      })
    })

    it('updates the profile and handle of an existing actor', async () => {
      await database.upsertBlueskyActor({
        did: 'did:plc:alice',
        handle: 'alice.example.com',
        name: 'Alice B',
        iconUrl: null
      })
      const actor = await database.getActorFromId({
        id: blueskyActorId('did:plc:alice')
      })
      expect(actor).toMatchObject({
        username: 'alice.example.com',
        domain: 'bsky.app',
        name: 'Alice B',
        summary: 'Hi'
      })
      expect(actor?.iconUrl).toBeFalsy()
    })

    it('moves a handle from one DID to another', async () => {
      await database.upsertBlueskyActor({
        did: 'did:plc:old',
        handle: 'moved.bsky.social'
      })
      await database.upsertBlueskyActor({
        did: 'did:plc:new',
        handle: 'moved.bsky.social'
      })
      const newer = await database.getActorFromId({
        id: blueskyActorId('did:plc:new')
      })
      const older = await database.getActorFromId({
        id: blueskyActorId('did:plc:old')
      })
      expect(newer?.username).toBe('moved.bsky.social')
      // The displaced row falls back to its DID, like an unverified handle.
      expect(older?.username).toBe('did:plc:old')
    })

    it('writes nothing when every given value is already stored', async () => {
      const params = {
        did: 'did:plc:steady',
        handle: 'steady.bsky.social',
        name: 'Steady',
        summary: '<p>Same</p>',
        iconUrl: 'https://cdn.bsky.app/steady.jpg',
        headerImageUrl: 'https://cdn.bsky.app/steady-banner.jpg',
        followersCount: 5,
        followingCount: 6,
        postsCount: 7
      }
      const actorId = blueskyActorId(params.did)
      await database.upsertBlueskyActor(params)
      const stale = new Date(Date.now() - 60 * 60 * 1000)
      const setUpdatedAt = () =>
        testDb.db
          .updateTable('actors')
          .set({ updatedAt: stale })
          .where('id', '=', actorId)
          .execute()
      const updatedAt = async () =>
        (await database.getActorFromId({ id: actorId }))?.updatedAt
      await setUpdatedAt()

      await database.upsertBlueskyActor(params)
      // A post's author view: no summary, banner or counts, which keep.
      await database.upsertBlueskyActor({
        did: params.did,
        handle: params.handle,
        name: params.name,
        iconUrl: params.iconUrl
      })
      expect(await updatedAt()).toBe(stale.getTime())

      // Each value alone rewrites the row: the stored values are put back
      // before each change, so no earlier change is reverted along with it.
      for (const change of [
        { handle: 'steady-moved.bsky.social' },
        { name: 'Changed' },
        { summary: '<p>Changed</p>' },
        { iconUrl: null },
        { headerImageUrl: 'https://cdn.bsky.app/other-banner.jpg' },
        { followingCount: 9 },
        { postsCount: 10 },
        { followersCount: 8 }
      ]) {
        await database.upsertBlueskyActor(params)
        await setUpdatedAt()
        await database.upsertBlueskyActor({ ...params, ...change })
        expect(await updatedAt(), JSON.stringify(change)).toBeGreaterThan(
          stale.getTime()
        )
      }
      expect(
        await database.getMastodonActorFromId({ id: actorId })
      ).toMatchObject({ display_name: 'Steady', followers_count: 8 })
    })

    it('recovers when a concurrent sync creates the same actor first', async () => {
      vi.mocked(createActor).mockImplementationOnce(async () => {
        throw Object.assign(new Error('duplicate key'), { code: '23505' })
      })
      expect(
        await database.upsertBlueskyActor({
          did: 'did:plc:racer',
          handle: 'racer.bsky.social',
          name: 'Racer'
        })
      ).toBe(blueskyActorId('did:plc:racer'))
      expect(
        await database.getActorFromId({ id: blueskyActorId('did:plc:racer') })
      ).toMatchObject({ username: 'racer.bsky.social', name: 'Racer' })
    })

    it("rethrows a concurrent create inside a caller's transaction instead of retrying", async () => {
      vi.mocked(createActor).mockClear()
      vi.mocked(createActor).mockImplementationOnce(async () => {
        throw Object.assign(new Error('duplicate key'), { code: '23505' })
      })

      await expect(
        testDb.db.transaction().execute((trx) =>
          upsertBlueskyActor(trx, {
            did: 'did:plc:intrx',
            handle: 'intrx.bsky.social'
          })
        )
      ).rejects.toThrow('duplicate key')
      expect(createActor).toHaveBeenCalledTimes(1)
    })

    it('leaves a non-Bluesky row with the same id alone', async () => {
      const id = blueskyActorId('did:plc:taken')
      await database.createActor({
        actorId: id,
        username: 'taken',
        domain: 'bsky.app',
        name: 'Original',
        inboxUrl: 'https://example.com/inbox',
        sharedInboxUrl: 'https://example.com/inbox',
        followersUrl: 'https://example.com/followers',
        publicKey: 'key',
        createdAt: Date.now()
      })
      expect(
        await database.upsertBlueskyActor({
          did: 'did:plc:taken',
          handle: 'other.bsky.social',
          name: 'Changed'
        })
      ).toBeNull()
      expect(await database.getActorFromId({ id })).toMatchObject({
        username: 'taken',
        name: 'Original'
      })
      expect(await networkOf('actors', id)).toBeNull()
    })
  })

  describe('upsertBlueskyPost', () => {
    const did = 'did:plc:poster'
    const actorId = blueskyActorId(did)
    const uri = `at://${did}/app.bsky.feed.post/3kpost`

    beforeAll(async () => {
      await database.upsertBlueskyActor({ did, handle: 'poster.bsky.social' })
    })

    it('stores the post, its record and attachments once', async () => {
      const params = {
        uri,
        cid: 'bafycid',
        did,
        rkey: '3kpost',
        actorId,
        text: '<p>Hello</p>',
        createdAt: Date.UTC(2026, 10, 1),
        attachments: [
          {
            url: 'https://cdn.bsky.app/full.jpg',
            thumbnailUrl: 'https://cdn.bsky.app/thumb.jpg',
            mediaType: 'image/jpeg',
            width: 4,
            height: 3,
            description: 'A cat'
          }
        ]
      }
      const first = await database.upsertBlueskyPost(params)
      const statusId = blueskyPostId(did, '3kpost')
      expect(first).toEqual({ statusId, created: true })
      expect(await database.upsertBlueskyPost(params)).toEqual({
        statusId,
        created: false
      })

      expect(await networkOf('statuses', statusId)).toBe('bluesky')
      const status = await database.getStatus({ statusId })
      expect(status).toMatchObject({
        actorId,
        text: '<p>Hello</p>',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        createdAt: Date.UTC(2026, 10, 1)
      })
      const attachments = await database.getAttachments({ statusId })
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        url: 'https://cdn.bsky.app/full.jpg',
        name: 'A cat',
        width: 4,
        height: 3
      })

      expect(
        await database.getBlueskyRecordByStatusId({ statusId })
      ).toMatchObject({ uri, cid: 'bafycid' })
      expect(await database.getBlueskyRecordByUri({ uri })).toMatchObject({
        statusId
      })
      expect(
        await database.getBlueskyRecordByUri({ uri: `${uri}-missing` })
      ).toBeNull()
    })

    it('reads a multi-image post back in its stored order', async () => {
      const urls = ['a', 'b', 'c', 'd'].map(
        (name) => `https://cdn.bsky.app/${name}.jpg`
      )
      // Attachments read back by createdAt then a random uuid id: without a
      // distinct createdAt per image the order is random, so store several
      // posts and check each one.
      for (let index = 0; index < 10; index++) {
        const { statusId } = await database.upsertBlueskyPost({
          uri: `at://${did}/app.bsky.feed.post/3korder${index}`,
          cid: `bafyorder${index}`,
          did,
          rkey: `3korder${index}`,
          actorId,
          text: '<p>Order</p>',
          createdAt: Date.UTC(2026, 10, 4),
          attachments: urls.map((url) => ({
            url,
            thumbnailUrl: `${url}?thumb`,
            mediaType: 'image/jpeg',
            width: 1,
            height: 1,
            description: url
          }))
        })
        const attachments = await database.getAttachments({ statusId })
        expect(attachments.map((attachment) => attachment.url)).toEqual(urls)
      }
    })

    it('stores a post again when its status was deleted', async () => {
      const params = {
        uri: `at://${did}/app.bsky.feed.post/3kgone`,
        cid: 'bafygone',
        did,
        rkey: '3kgone',
        actorId,
        text: '<p>Gone</p>',
        createdAt: Date.UTC(2026, 10, 3),
        attachments: []
      }
      const { statusId } = await database.upsertBlueskyPost(params)
      await testDb.db
        .deleteFrom('statuses')
        .where('id', '=', statusId)
        .execute()

      expect(await database.upsertBlueskyPost(params)).toEqual({
        statusId,
        created: true
      })
      expect(await database.getStatus({ statusId })).toMatchObject({
        text: '<p>Gone</p>'
      })
    })

    it("tells whether a post is in an actor's Home", async () => {
      const statusId = blueskyPostId(did, '3kpost')
      const reader = 'https://local.test/users/home-reader'
      const inHome = (actor: string) =>
        database.isBlueskyPostInHome({ actorId: actor, statusId })
      expect(await inHome(reader)).toBe(false)
      const status = (await database.getStatus({ statusId })) as Status
      await database.createTimelineStatus({
        actorId: reader,
        status,
        timeline: Timeline.DIRECT
      })
      expect(await inHome(reader)).toBe(false)
      await database.createTimelineStatus({
        actorId: reader,
        status,
        timeline: Timeline.MAIN
      })
      expect(await inHome(reader)).toBe(true)
      expect(await inHome('https://local.test/users/other')).toBe(false)
    })

    it("removes only boosts of the target status from the actor's Home, leaving the Announce statuses and other timelines intact", async () => {
      const statusId = blueskyPostId(did, '3kpost')
      const { statusId: otherStatusId } = await database.upsertBlueskyPost({
        uri: `at://${did}/app.bsky.feed.post/3kotherboost`,
        cid: 'bafyotherboost',
        did,
        rkey: '3kotherboost',
        actorId,
        text: '<p>Other</p>',
        createdAt: Date.UTC(2026, 10, 8),
        attachments: []
      })
      const reader = 'https://local.test/users/boost-reader'
      const booster = 'https://local.test/users/boost-booster'
      const secondBooster = 'https://local.test/users/boost-second-booster'
      const otherReader = 'https://local.test/users/boost-other-reader'

      const timelineStatusIds = async (
        viewer: string,
        timeline: Timeline = Timeline.MAIN
      ) =>
        (
          await testDb.db
            .selectFrom('timelines')
            .select('statusId')
            .where('actorId', '=', viewer)
            .where('timeline', '=', timeline)
            .execute()
        ).map((row) => row.statusId)

      const original = (await database.getStatus({ statusId })) as Status
      const otherBoost = (await database.createAnnounce({
        id: `${booster}/statuses/announce-other`,
        actorId: booster,
        originalStatusId: otherStatusId,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: []
      })) as Status
      const boost = (await database.createAnnounce({
        id: `${booster}/statuses/announce-target`,
        actorId: booster,
        originalStatusId: statusId,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: []
      })) as Status
      const secondBoost = (await database.createAnnounce({
        id: `${secondBooster}/statuses/announce-target-2`,
        actorId: secondBooster,
        originalStatusId: statusId,
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: []
      })) as Status

      // Reader's MAIN has the original, a boost of another post, and two boosts
      // of the target post.
      for (const status of [original, otherBoost, boost, secondBoost]) {
        await database.createTimelineStatus({
          actorId: reader,
          status,
          timeline: Timeline.MAIN
        })
      }
      // Same boost also sits in reader's DIRECT and in another actor's MAIN.
      await database.createTimelineStatus({
        actorId: reader,
        status: boost,
        timeline: Timeline.DIRECT
      })
      await database.createTimelineStatus({
        actorId: otherReader,
        status: boost,
        timeline: Timeline.MAIN
      })

      await database.removeBoostsOfStatusFromHome({
        actorId: reader,
        statusId
      })

      expect((await timelineStatusIds(reader, Timeline.MAIN)).sort()).toEqual(
        [original.id, otherBoost.id].sort()
      )
      expect(await timelineStatusIds(reader, Timeline.DIRECT)).toEqual([
        boost.id
      ])
      expect(await timelineStatusIds(otherReader, Timeline.MAIN)).toEqual([
        boost.id
      ])
      // The Announce status rows themselves stay intact.
      expect(await database.getStatus({ statusId: boost.id })).not.toBeNull()
      expect(
        await database.getStatus({ statusId: secondBoost.id })
      ).not.toBeNull()
    })

    it('stores a sensitive post and defaults to not sensitive', async () => {
      const sensitiveId = blueskyPostId(did, '3knsfw')
      await database.upsertBlueskyPost({
        uri: `at://${did}/app.bsky.feed.post/3knsfw`,
        cid: 'bafynsfw',
        did,
        rkey: '3knsfw',
        actorId,
        text: '<p>NSFW</p>',
        createdAt: Date.UTC(2026, 10, 5),
        attachments: [],
        sensitive: true
      })
      expect(await database.getStatus({ statusId: sensitiveId })).toMatchObject(
        { sensitive: true }
      )

      const plainId = blueskyPostId(did, '3kplain')
      await database.upsertBlueskyPost({
        uri: `at://${did}/app.bsky.feed.post/3kplain`,
        cid: 'bafyplain',
        did,
        rkey: '3kplain',
        actorId,
        text: '<p>Plain</p>',
        createdAt: Date.UTC(2026, 10, 6),
        attachments: []
      })
      expect(await database.getStatus({ statusId: plainId })).toMatchObject({
        sensitive: false
      })
    })

    it('stores a reply to a stored post', async () => {
      const parentId = blueskyPostId(did, '3kpost')
      const { statusId } = await database.upsertBlueskyPost({
        uri: `at://${did}/app.bsky.feed.post/3kreply`,
        cid: 'bafyreply',
        did,
        rkey: '3kreply',
        actorId,
        text: '<p>Reply</p>',
        createdAt: Date.UTC(2026, 10, 2),
        replyToStatusId: parentId,
        attachments: []
      })
      expect(await database.getStatus({ statusId })).toMatchObject({
        reply: parentId
      })
    })
  })

  describe('follows', () => {
    it('creates, replaces, lists and deletes follows', async () => {
      const actorId = 'https://local.test/users/follower'
      const target = blueskyActorId('did:plc:alice')
      await database.createBlueskyFollow({
        actorId,
        targetActorId: target,
        uri: 'at://did:plc:me/app.bsky.graph.follow/1'
      })
      await database.createBlueskyFollow({
        actorId,
        targetActorId: target,
        uri: 'at://did:plc:me/app.bsky.graph.follow/2'
      })
      expect(
        await database.getBlueskyFollow({ actorId, targetActorId: target })
      ).toMatchObject({ uri: 'at://did:plc:me/app.bsky.graph.follow/2' })
      expect(await database.getBlueskyFollowTargetIds({ actorId })).toEqual([
        target
      ])

      await database.deleteBlueskyFollow({ actorId, targetActorId: target })
      expect(
        await database.getBlueskyFollow({ actorId, targetActorId: target })
      ).toBeNull()
      expect(await database.getBlueskyFollowTargetIds({ actorId })).toEqual([])
    })
  })

  describe('interactions', () => {
    it('creates idempotently, reads and deletes likes and reposts', async () => {
      const actorId = 'https://local.test/users/interactor'
      const statusId = blueskyPostId('did:plc:poster', '3kinteract')
      const likeUri = 'at://did:plc:me/app.bsky.feed.like/1'
      const repostUri = 'at://did:plc:me/app.bsky.feed.repost/1'

      expect(
        await database.getBlueskyInteraction({
          actorId,
          statusId,
          kind: 'like'
        })
      ).toBeNull()

      await database.createBlueskyInteraction({
        actorId,
        statusId,
        kind: 'like',
        uri: likeUri
      })
      // Idempotent create keeps the original record URI on conflict.
      await database.createBlueskyInteraction({
        actorId,
        statusId,
        kind: 'like',
        uri: 'at://did:plc:me/app.bsky.feed.like/2'
      })
      await database.createBlueskyInteraction({
        actorId,
        statusId,
        kind: 'repost',
        uri: repostUri
      })

      expect(
        await database.getBlueskyInteraction({
          actorId,
          statusId,
          kind: 'like'
        })
      ).toMatchObject({
        actorId,
        statusId,
        kind: 'like',
        uri: likeUri
      })
      expect(
        await database.getBlueskyInteraction({
          actorId,
          statusId,
          kind: 'repost'
        })
      ).toMatchObject({
        actorId,
        statusId,
        kind: 'repost',
        uri: repostUri
      })

      await database.deleteBlueskyInteraction({
        actorId,
        statusId,
        kind: 'like'
      })
      expect(
        await database.getBlueskyInteraction({
          actorId,
          statusId,
          kind: 'like'
        })
      ).toBeNull()
      expect(
        await database.getBlueskyInteraction({
          actorId,
          statusId,
          kind: 'repost'
        })
      ).toMatchObject({ uri: repostUri })
    })
  })

  describe('setBlueskyPostCounts', () => {
    it('sets counters read back by status hydration and skips invalid values', async () => {
      const did = 'did:plc:counter-author'
      const actorId = (await database.upsertBlueskyActor({
        did,
        handle: 'counter-author.bsky.social'
      })) as string
      const { statusId } = await database.upsertBlueskyPost({
        uri: `at://${did}/app.bsky.feed.post/3kcounts`,
        cid: 'bafycounts',
        did,
        rkey: '3kcounts',
        actorId,
        text: '<p>Counts</p>',
        createdAt: Date.UTC(2026, 10, 7),
        attachments: []
      })

      await database.setBlueskyPostCounts({
        statusId,
        likes: 12,
        reposts: 4,
        replies: 7
      })
      expect(await database.getStatus({ statusId })).toMatchObject({
        totalLikes: 12,
        totalShares: 4
      })
      expect(await database.getStatusReblogsCount({ statusId })).toBe(4)
      expect(await database.getStatusRepliesCount({ statusId })).toBe(7)

      // Negative, non-integer, non-finite and missing values leave existing
      // counters intact.
      await database.setBlueskyPostCounts({
        statusId,
        likes: -1,
        reposts: 2.5,
        replies: Number.NaN
      })
      await database.setBlueskyPostCounts({
        statusId,
        likes: Number.POSITIVE_INFINITY,
        reposts: null,
        replies: undefined
      })
      expect(await database.getStatus({ statusId })).toMatchObject({
        totalLikes: 12,
        totalShares: 4
      })
      expect(await database.getStatusRepliesCount({ statusId })).toBe(7)

      // Zero is a valid count.
      await database.setBlueskyPostCounts({
        statusId,
        likes: 0,
        reposts: 0,
        replies: 0
      })
      expect(await database.getStatus({ statusId })).toMatchObject({
        totalLikes: 0,
        totalShares: 0
      })
      expect(await database.getStatusRepliesCount({ statusId })).toBe(0)
    })
  })

  describe('updateBlueskyAccountSync', () => {
    it('sets and clears the sync state', async () => {
      const actorId = 'https://local.test/users/syncer'
      await database.saveBlueskyAccount({
        actorId,
        did: 'did:plc:syncer',
        handle: 'syncer.bsky.social',
        pdsUrl: 'https://pds.example.net/',
        authType: 'oauth',
        domainHandle: false
      })
      const readSync = () =>
        testDb.db
          .selectFrom('bluesky_accounts')
          .select(['lastSyncedAt', 'syncError'])
          .where('actorId', '=', actorId)
          .executeTakeFirstOrThrow()

      await database.updateBlueskyAccountSync({
        actorId,
        syncError: 'expired'
      })
      expect(await readSync()).toMatchObject({
        lastSyncedAt: null,
        syncError: 'expired'
      })

      const syncedAt = Date.UTC(2026, 10, 24)
      await database.updateBlueskyAccountSync({
        actorId,
        lastSyncedAt: syncedAt,
        syncError: null
      })
      expect(await readSync()).toEqual({
        lastSyncedAt: syncedAt,
        syncError: null
      })
    })
  })

  describe('crossposts', () => {
    const statusId = 'https://local.test/users/crossposter/statuses/1'
    const actorId = 'https://local.test/users/crossposter'
    const uri = 'at://did:plc:crossposter/app.bsky.feed.post/3k1'

    beforeEach(async () => {
      await database.deleteBlueskyCrosspost({ statusId })
    })

    it('claims a status once and leaves the existing row alone', async () => {
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()

      expect(await database.claimBlueskyCrosspost({ statusId, actorId })).toBe(
        true
      )
      expect(await database.claimBlueskyCrosspost({ statusId, actorId })).toBe(
        false
      )

      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        statusId,
        actorId,
        uri: null,
        cid: null,
        state: 'pending',
        error: null
      })
    })

    const readAttemptId = async () => {
      const row = await testDb.db
        .selectFrom('bluesky_crossposts')
        .select('attemptId')
        .where('statusId', '=', statusId)
        .executeTakeFirst()
      return row?.attemptId ?? null
    }

    it('marks a cross-post posted only with its owning attempt token and reads it back by URI', async () => {
      await database.claimBlueskyCrosspost({ statusId, actorId })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      expect(attemptId).toEqual(expect.any(String))
      expect(await readAttemptId()).toBe(attemptId)
      expect(
        await database.markBlueskyCrosspostPosted({
          statusId,
          attemptId: attemptId!,
          uri,
          cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ua2r7w7v4v4v4v4v4v4'
        })
      ).toBe(true)

      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'posted',
        uri,
        error: null
      })
      expect(await readAttemptId()).toBeNull()
      // Already posted: cannot be marked posted again.
      expect(
        await database.markBlueskyCrosspostPosted({
          statusId,
          attemptId: attemptId!,
          uri: 'at://did:plc:crossposter/app.bsky.feed.post/3k2',
          cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ua2r7w7v4v4v4v4v4v4'
        })
      ).toBe(false)
      expect(await database.getBlueskyCrosspostByUri({ uri })).toMatchObject({
        statusId,
        state: 'posted'
      })
      expect(
        await database.getBlueskyCrosspostByUri({ uri: 'at://missing' })
      ).toBeNull()
    })

    it('begins an attempt exclusively, fences stale takeovers by token, and releases back to pending with a fresh updatedAt', async () => {
      await database.claimBlueskyCrosspost({ statusId, actorId })

      const firstToken = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      expect(firstToken).toEqual(expect.any(String))
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'posting'
      })
      expect(await readAttemptId()).toBe(firstToken)
      // A fresh posting row is owned by the running attempt.
      expect(
        await database.beginBlueskyCrosspostAttempt({ statusId })
      ).toBeNull()

      // Release moves posting back to pending, clears attemptId, and refreshes updatedAt.
      const staleTime = Date.now() - 20 * 60 * 1000
      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(staleTime) })
        .where('statusId', '=', statusId)
        .execute()

      expect(
        await database.releaseBlueskyCrosspostAttempt({
          statusId,
          attemptId: firstToken!
        })
      ).toBe(true)
      const released = await database.getBlueskyCrosspost({ statusId })
      expect(released).toMatchObject({ state: 'pending' })
      expect(released!.updatedAt).toBeGreaterThan(staleTime)
      expect(await readAttemptId()).toBeNull()

      // Next attempt begins, goes stale (> 30 min), and is taken over with a new token.
      const staleToken = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      expect(staleToken).toEqual(expect.any(String))
      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
        .where('statusId', '=', statusId)
        .execute()
      const takeoverToken = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      expect(takeoverToken).toEqual(expect.any(String))
      expect(takeoverToken).not.toBe(staleToken)
      expect(await readAttemptId()).toBe(takeoverToken)
      // Once taken over, updatedAt is fresh so another caller is refused.
      expect(
        await database.beginBlueskyCrosspostAttempt({ statusId })
      ).toBeNull()

      // The old attempt's release, markFailed and markPosted with its old token change nothing.
      expect(
        await database.releaseBlueskyCrosspostAttempt({
          statusId,
          attemptId: staleToken!
        })
      ).toBe(false)
      expect(
        await database.markBlueskyCrosspostFailed({
          statusId,
          attemptId: staleToken!,
          error: 'stale failure'
        })
      ).toBe(false)
      expect(
        await database.markBlueskyCrosspostPosted({
          statusId,
          attemptId: staleToken!,
          uri: 'at://did:plc:crossposter/app.bsky.feed.post/3kstale',
          cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ua2r7w7v4v4v4v4v4v4'
        })
      ).toBe(false)
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'posting',
        uri: null,
        error: null
      })
      expect(await readAttemptId()).toBe(takeoverToken)

      // Mark posted with the owning token: begin, release and markFailed leave posted rows untouched.
      expect(
        await database.markBlueskyCrosspostPosted({
          statusId,
          attemptId: takeoverToken!,
          uri,
          cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ua2r7w7v4v4v4v4v4v4'
        })
      ).toBe(true)
      expect(await readAttemptId()).toBeNull()
      expect(
        await database.beginBlueskyCrosspostAttempt({ statusId })
      ).toBeNull()
      expect(
        await database.releaseBlueskyCrosspostAttempt({
          statusId,
          attemptId: takeoverToken!
        })
      ).toBe(false)
      expect(
        await database.markBlueskyCrosspostFailed({
          statusId,
          attemptId: takeoverToken!,
          error: 'ignored'
        })
      ).toBe(false)
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'posted',
        uri,
        error: null
      })
    })

    it('marks a cross-post failed and resets it for a retry', async () => {
      await database.claimBlueskyCrosspost({ statusId, actorId })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      expect(
        await database.markBlueskyCrosspostFailed({
          statusId,
          attemptId: attemptId!,
          error: 'Bluesky refused the post'
        })
      ).toBe(true)
      expect(await readAttemptId()).toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'failed',
        error: 'Bluesky refused the post'
      })

      expect(await database.resetBlueskyCrosspostForRetry({ statusId })).toBe(
        true
      )
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'pending',
        error: null
      })
      // Only a failed or stale cross-post can be reset.
      expect(await database.resetBlueskyCrosspostForRetry({ statusId })).toBe(
        false
      )
    })

    it('markBlueskyCrosspostFailedIfAttemptable and deleteBlueskyCrosspostIfAttemptable touch pending and stale posting rows only', async () => {
      await database.claimBlueskyCrosspost({ statusId, actorId })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })

      // Neither non-owner helper touches a fresh actively posting row.
      expect(
        await database.markBlueskyCrosspostFailedIfAttemptable({
          statusId,
          error: 'should not touch posting'
        })
      ).toBe(false)
      expect(
        await database.deleteBlueskyCrosspostIfAttemptable({ statusId })
      ).toBe(false)
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'posting',
        error: null
      })
      expect(await readAttemptId()).toBe(attemptId)

      // A stale posting row (worker crashed past STALE_CROSSPOST_MS) CAN be failed.
      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
        .where('statusId', '=', statusId)
        .execute()
      expect(
        await database.markBlueskyCrosspostFailedIfAttemptable({
          statusId,
          error: 'stale posting failed'
        })
      ).toBe(true)
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'failed',
        error: 'stale posting failed'
      })
      expect(await readAttemptId()).toBeNull()

      // A stale posting row CAN also be deleted.
      await database.resetBlueskyCrosspostForRetry({ statusId })
      const staleAttemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      expect(staleAttemptId).toEqual(expect.any(String))
      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
        .where('statusId', '=', statusId)
        .execute()
      expect(
        await database.deleteBlueskyCrosspostIfAttemptable({ statusId })
      ).toBe(true)
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()

      // Neither touches a posted row.
      await database.claimBlueskyCrosspost({ statusId, actorId })
      const postedAttemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      await database.markBlueskyCrosspostPosted({
        statusId,
        attemptId: postedAttemptId!,
        uri,
        cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ua2r7w7v4v4v4v4v4v4'
      })
      expect(
        await database.markBlueskyCrosspostFailedIfAttemptable({
          statusId,
          error: 'should not touch posted'
        })
      ).toBe(false)
      expect(
        await database.deleteBlueskyCrosspostIfAttemptable({ statusId })
      ).toBe(false)
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'posted',
        uri
      })

      // Pending row can be failed by markBlueskyCrosspostFailedIfAttemptable.
      await database.deleteBlueskyCrosspost({ statusId })
      await database.claimBlueskyCrosspost({ statusId, actorId })
      expect(
        await database.markBlueskyCrosspostFailedIfAttemptable({
          statusId,
          error: 'queue down'
        })
      ).toBe(true)
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'failed',
        error: 'queue down'
      })

      // Failed row is not deleted by deleteBlueskyCrosspostIfAttemptable.
      expect(
        await database.deleteBlueskyCrosspostIfAttemptable({ statusId })
      ).toBe(false)

      // Pending row is deleted by deleteBlueskyCrosspostIfAttemptable.
      await database.resetBlueskyCrosspostForRetry({ statusId })
      expect(
        await database.deleteBlueskyCrosspostIfAttemptable({ statusId })
      ).toBe(true)
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
    })

    it('resets a stale pending or stale posting cross-post, but not a fresh one', async () => {
      await database.claimBlueskyCrosspost({ statusId, actorId })
      // A fresh pending row may still have a job working on it.
      expect(await database.resetBlueskyCrosspostForRetry({ statusId })).toBe(
        false
      )

      // Older than STALE_CROSSPOST_MS: its job was dead-lettered.
      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
        .where('statusId', '=', statusId)
        .execute()

      expect(await database.resetBlueskyCrosspostForRetry({ statusId })).toBe(
        true
      )
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'pending',
        error: null
      })
      // The reset refreshed updatedAt, so the row is no longer stale.
      expect(await database.resetBlueskyCrosspostForRetry({ statusId })).toBe(
        false
      )

      // A fresh posting row is actively in flight and must not be reset.
      expect(await database.beginBlueskyCrosspostAttempt({ statusId })).toEqual(
        expect.any(String)
      )
      expect(await database.resetBlueskyCrosspostForRetry({ statusId })).toBe(
        false
      )

      // A stale posting row (worker crashed mid-attempt) can be reset and clears attemptId.
      await testDb.db
        .updateTable('bluesky_crossposts')
        .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
        .where('statusId', '=', statusId)
        .execute()
      expect(await database.resetBlueskyCrosspostForRetry({ statusId })).toBe(
        true
      )
      expect(await readAttemptId()).toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        state: 'pending',
        error: null
      })
      expect(await database.resetBlueskyCrosspostForRetry({ statusId })).toBe(
        false
      )
    })

    it('deletes a cross-post and returns the deleted row', async () => {
      await database.claimBlueskyCrosspost({ statusId, actorId })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      await database.markBlueskyCrosspostPosted({
        statusId,
        attemptId: attemptId!,
        uri,
        cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ua2r7w7v4v4v4v4v4v4'
      })
      expect(await database.deleteBlueskyCrosspost({ statusId })).toMatchObject(
        {
          statusId,
          state: 'posted',
          uri
        }
      )
      expect(await database.deleteBlueskyCrosspost({ statusId })).toBeNull()
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
    })

    it('deleteBlueskyCrosspostWithQueueJob deletes the row and inserts the queue job atomically, rolling back on insert failure', async () => {
      await database.claimBlueskyCrosspost({ statusId, actorId })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      await database.markBlueskyCrosspostPosted({
        statusId,
        attemptId: attemptId!,
        uri,
        cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ua2r7w7v4v4v4v4v4v4'
      })

      // Conflict on queue_jobs.id with a different job name causes
      // createQueueJob to throw; the transaction must roll back and keep the
      // cross-post row intact.
      const conflictingJobId = 'crosspost-delete-conflict'
      await database.createQueueJob({
        id: conflictingJobId,
        name: 'otherJob',
        payload: { id: conflictingJobId, name: 'otherJob', data: {} },
        attempts: 0,
        maxRetries: 3,
        nextRunAt: new Date(),
        status: 'pending'
      })

      await expect(
        database.deleteBlueskyCrosspostWithQueueJob({
          statusId,
          buildQueueJob: (crosspost) => ({
            id: conflictingJobId,
            name: 'deleteBlueskyCrosspost',
            payload: {
              id: conflictingJobId,
              name: 'deleteBlueskyCrosspost',
              data: { actorId, uri: crosspost.uri }
            },
            attempts: 0,
            maxRetries: 16,
            nextRunAt: new Date(),
            status: 'pending'
          })
        })
      ).rejects.toThrow()
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        statusId,
        state: 'posted',
        uri
      })

      // Succeeding insert deletes the cross-post row and stores the queue job.
      const jobId = 'crosspost-delete-atomic'
      const deleted = await database.deleteBlueskyCrosspostWithQueueJob({
        statusId,
        buildQueueJob: (crosspost) => ({
          id: jobId,
          name: 'deleteBlueskyCrosspost',
          payload: {
            id: jobId,
            name: 'deleteBlueskyCrosspost',
            data: { actorId, uri: crosspost.uri }
          },
          attempts: 0,
          maxRetries: 9,
          nextRunAt: new Date(),
          status: 'pending'
        })
      })
      expect(deleted).toMatchObject({ statusId, state: 'posted', uri })
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      expect(await getQueueJobById(testDb.db, jobId)).toMatchObject({
        id: jobId,
        name: 'deleteBlueskyCrosspost',
        maxRetries: 9,
        status: 'pending'
      })

      // When buildQueueJob returns null (non-posted row), deletes without a job.
      await database.claimBlueskyCrosspost({ statusId, actorId })
      const builder = vi.fn().mockReturnValue(null)
      expect(
        await database.deleteBlueskyCrosspostWithQueueJob({
          statusId,
          buildQueueJob: builder
        })
      ).toMatchObject({ statusId, state: 'pending' })
      expect(builder).toHaveBeenCalledTimes(1)
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()
      expect(
        await database.deleteBlueskyCrosspostWithQueueJob({
          statusId,
          buildQueueJob: builder
        })
      ).toBeNull()
    })

    it('deleteBlueskyCrosspostUnlessPosted deletes non-posted rows and preserves posted rows with a uri', async () => {
      // Absent row -> null.
      expect(
        await database.deleteBlueskyCrosspostUnlessPosted({ statusId })
      ).toBeNull()

      // Pending row -> deleted, returns deleted row with deleted: true.
      await database.claimBlueskyCrosspost({ statusId, actorId })
      expect(
        await database.deleteBlueskyCrosspostUnlessPosted({ statusId })
      ).toMatchObject({
        deleted: true,
        crosspost: { statusId, state: 'pending', uri: null }
      })
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()

      // Posting row -> deleted, returns deleted row with deleted: true.
      await database.claimBlueskyCrosspost({ statusId, actorId })
      await database.beginBlueskyCrosspostAttempt({ statusId })
      expect(
        await database.deleteBlueskyCrosspostUnlessPosted({ statusId })
      ).toMatchObject({
        deleted: true,
        crosspost: { statusId, state: 'posting', uri: null }
      })
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()

      // Failed row -> deleted, returns deleted row with deleted: true.
      await database.claimBlueskyCrosspost({ statusId, actorId })
      await database.markBlueskyCrosspostFailedIfAttemptable({
        statusId,
        error: 'failed'
      })
      expect(
        await database.deleteBlueskyCrosspostUnlessPosted({ statusId })
      ).toMatchObject({
        deleted: true,
        crosspost: { statusId, state: 'failed', uri: null }
      })
      expect(await database.getBlueskyCrosspost({ statusId })).toBeNull()

      // Posted row with uri -> kept intact in DB and returned with deleted: false.
      await database.claimBlueskyCrosspost({ statusId, actorId })
      const attemptId = await database.beginBlueskyCrosspostAttempt({
        statusId
      })
      await database.markBlueskyCrosspostPosted({
        statusId,
        attemptId: attemptId!,
        uri,
        cid: 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ua2r7w7v4v4v4v4v4v4'
      })
      expect(
        await database.deleteBlueskyCrosspostUnlessPosted({ statusId })
      ).toMatchObject({
        deleted: false,
        crosspost: { statusId, state: 'posted', uri }
      })
      expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
        statusId,
        state: 'posted',
        uri
      })
    })
  })
})
