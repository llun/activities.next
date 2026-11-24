import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  type BlueskyAgent,
  BlueskyRequestError,
  BlueskySessionChangedError,
  BlueskySessionEndedError,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import { BlueskyLockTimeoutError } from '@/lib/services/bluesky/client'
import {
  blueskyInteractionFailure,
  likeBlueskyPost,
  repostBlueskyPost,
  unlikeBlueskyPost,
  unrepostBlueskyPost
} from '@/lib/services/bluesky/interactions'
import { getQueue } from '@/lib/services/queue'
import * as timelinesService from '@/lib/services/timelines'
import { storeBlueskyPost } from '@/lib/stub/blueskyPost'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import type { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

vi.mock('@/lib/services/bluesky/agent', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBlueskyAgent: vi.fn()
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

const OWN_DID = 'did:plc:meaaaaaaaaaaaaaaaaaaaaaa'
const LIKE_URI = `at://${OWN_DID}/app.bsky.feed.like/3klike`
const REPOST_URI = `at://${OWN_DID}/app.bsky.feed.repost/3krepost`

describe('Bluesky interactions service', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let actor: Actor
  let statusId: string
  let postUri: string
  let postCid: string

  const getPosts = vi.fn()
  const getRecord = vi.fn()
  const get = vi.fn(async (nsid: string, params?: unknown) => {
    if (nsid === 'app.bsky.feed.getPosts') return getPosts(params)
    if (nsid === 'com.atproto.repo.getRecord') return getRecord(params)
    throw new Error(`Unexpected get ${nsid}`)
  })
  const post = vi.fn()

  const linkAccount = (did: string) =>
    database.saveBlueskyAccount({
      actorId: actor.id,
      did,
      handle: 'me.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromEmail({
      email: seedActor1.email
    })) as Actor
    const stored = await storeBlueskyPost(database, 'interact')
    statusId = stored.statusId
    const record = await database.getBlueskyRecordByStatusId({ statusId })
    postUri = record!.uri
    postCid = record!.cid
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    get.mockClear()
    getPosts.mockReset()
    getPosts.mockResolvedValue({ posts: [{ uri: postUri, viewer: {} }] })
    getRecord.mockReset()
    getRecord.mockResolvedValue({ value: { subject: { uri: postUri } } })
    post.mockReset()
    vi.mocked(getBlueskyAgent).mockResolvedValue({
      did: OWN_DID,
      pdsUrl: 'https://pds.example.net/',
      get,
      post
    } as unknown as BlueskyAgent)
    await linkAccount(OWN_DID)
    await database.deleteBlueskyInteraction({
      actorId: actor.id,
      statusId,
      kind: 'like'
    })
    await database.deleteBlueskyInteraction({
      actorId: actor.id,
      statusId,
      kind: 'repost'
    })
    await database.deleteLike({ actorId: actor.id, statusId })
    const existingAnnounce = await database.getActorAnnounceStatus({
      actorId: actor.id,
      statusId
    })
    if (existingAnnounce) {
      await database.deleteStatus({ statusId: existingAnnounce.id })
    }
  })

  describe('likeBlueskyPost and unlikeBlueskyPost', () => {
    it('creates a like record, stores bluesky_interactions and a local like without federation or notifications', async () => {
      post.mockResolvedValue({ uri: LIKE_URI, cid: 'bafy' })

      const interaction = await likeBlueskyPost(database, actor, statusId)

      expect(post).toHaveBeenCalledWith('com.atproto.repo.createRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.like',
        record: {
          $type: 'app.bsky.feed.like',
          subject: { uri: postUri, cid: postCid },
          createdAt: expect.any(String)
        }
      })
      expect(interaction).toMatchObject({
        actorId: actor.id,
        statusId,
        kind: 'like',
        uri: LIKE_URI
      })
      await expect(
        database.isActorLikedStatus({ actorId: actor.id, statusId })
      ).resolves.toBe(true)
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('is idempotent when already stored and does not write another record', async () => {
      await database.createBlueskyInteraction({
        actorId: actor.id,
        statusId,
        kind: 'like',
        uri: LIKE_URI
      })
      await database.createLike({ actorId: actor.id, statusId })

      const interaction = await likeBlueskyPost(database, actor, statusId)

      expect(interaction.uri).toBe(LIKE_URI)
      expect(get).not.toHaveBeenCalled()
      expect(post).not.toHaveBeenCalled()
    })

    it('adopts an existing like in the user repo after confirming with getRecord', async () => {
      const externalUri = `at://${OWN_DID}/app.bsky.feed.like/3kexternal`
      getPosts.mockResolvedValue({
        posts: [{ uri: postUri, viewer: { like: externalUri } }]
      })

      const interaction = await likeBlueskyPost(database, actor, statusId)

      expect(get).toHaveBeenCalledWith('app.bsky.feed.getPosts', {
        uris: [postUri]
      })
      expect(get).toHaveBeenCalledWith('com.atproto.repo.getRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.like',
        rkey: '3kexternal'
      })
      expect(post).not.toHaveBeenCalled()
      expect(interaction.uri).toBe(externalUri)
      await expect(
        database.isActorLikedStatus({ actorId: actor.id, statusId })
      ).resolves.toBe(true)
    })

    it.each([
      [
        'another repo',
        'at://did:plc:someone/app.bsky.feed.like/3kother',
        undefined
      ],
      [
        'another collection',
        `at://${OWN_DID}/app.bsky.feed.repost/3kother`,
        undefined
      ],
      [
        'over 512 chars',
        `at://${OWN_DID}/app.bsky.feed.like/${'k'.repeat(480)}`,
        undefined
      ],
      [
        'wrong subject uri',
        `at://${OWN_DID}/app.bsky.feed.like/3kother`,
        { value: { subject: { uri: 'at://did:plc:x/app.bsky.feed.post/9' } } }
      ]
    ])(
      'ignores viewer.like (%s) and writes a new like record',
      async (_label, candidateUri, recordResponse) => {
        getPosts.mockResolvedValue({
          posts: [{ viewer: { like: candidateUri } }]
        })
        if (recordResponse) getRecord.mockResolvedValue(recordResponse)
        post.mockResolvedValue({ uri: LIKE_URI })

        const interaction = await likeBlueskyPost(database, actor, statusId)

        expect(post).toHaveBeenCalledWith(
          'com.atproto.repo.createRecord',
          expect.objectContaining({ collection: 'app.bsky.feed.like' })
        )
        expect(interaction.uri).toBe(LIKE_URI)
      }
    )

    it('writes a record when viewer lookup returns 400 (stale/not found)', async () => {
      getPosts.mockRejectedValue(
        new BlueskyRequestError('app.bsky.feed.getPosts', 400, 'InvalidRequest')
      )
      post.mockResolvedValue({ uri: LIKE_URI })

      const interaction = await likeBlueskyPost(database, actor, statusId)
      expect(interaction.uri).toBe(LIKE_URI)
    })

    it.each([503, 429])(
      'propagates HTTP %s from viewer lookup without writing a record',
      async (status) => {
        getPosts.mockRejectedValue(
          new BlueskyRequestError('app.bsky.feed.getPosts', status)
        )

        await expect(
          likeBlueskyPost(database, actor, statusId)
        ).rejects.toBeInstanceOf(BlueskyRequestError)
        expect(post).not.toHaveBeenCalled()
      }
    )

    it('writes one record when concurrent like requests race', async () => {
      post.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ uri: LIKE_URI }), 50)
          )
      )

      const [first, second] = await Promise.all([
        likeBlueskyPost(database, actor, statusId),
        likeBlueskyPost(database, actor, statusId)
      ])

      expect(post).toHaveBeenCalledTimes(1)
      expect(first.uri).toBe(LIKE_URI)
      expect(second.uri).toBe(LIKE_URI)
    })

    it('refuses a createRecord answer naming another repo or collection', async () => {
      post.mockResolvedValue({
        uri: 'at://did:plc:someone/app.bsky.feed.like/3kbad'
      })

      await expect(likeBlueskyPost(database, actor, statusId)).rejects.toThrow(
        'Bluesky createRecord gave an unexpected answer'
      )
      await expect(
        database.getBlueskyInteraction({
          actorId: actor.id,
          statusId,
          kind: 'like'
        })
      ).resolves.toBeNull()
      await expect(
        database.isActorLikedStatus({ actorId: actor.id, statusId })
      ).resolves.toBe(false)
    })

    it('throws BlueskySessionChangedError when relinked mid-call and stores nothing', async () => {
      post.mockImplementation(async () => {
        await linkAccount('did:plc:relinkedaaaaaaaaaaaaaaaa')
        return { uri: LIKE_URI }
      })

      await expect(
        likeBlueskyPost(database, actor, statusId)
      ).rejects.toBeInstanceOf(BlueskySessionChangedError)
      await expect(
        database.getBlueskyInteraction({
          actorId: actor.id,
          statusId,
          kind: 'like'
        })
      ).resolves.toBeNull()
      await expect(
        database.isActorLikedStatus({ actorId: actor.id, statusId })
      ).resolves.toBe(false)
    })

    it('throws not-linked 422 when unlinked mid-call and stores nothing', async () => {
      post.mockImplementation(async () => {
        await database.deleteBlueskyAccount({ actorId: actor.id })
        return { uri: LIKE_URI }
      })

      const error = await likeBlueskyPost(database, actor, statusId).catch(
        (caught: unknown) => caught
      )
      expect(blueskyInteractionFailure(error)).toMatchObject({
        status: 422,
        error: expect.stringContaining('Settings › Other networks')
      })
      await expect(
        database.isActorLikedStatus({ actorId: actor.id, statusId })
      ).resolves.toBe(false)
    })

    it('throws 404 when the status is missing or not a Bluesky post', async () => {
      for (const badId of [
        'https://bsky.app/profile/did:plc:missing/post/3k',
        `${actor.id}/statuses/post-1`
      ]) {
        const error = await likeBlueskyPost(database, actor, badId).catch(
          (caught: unknown) => caught
        )
        expect(blueskyInteractionFailure(error)).toEqual({
          status: 404,
          error: 'Record not found'
        })
      }
    })

    it('refuses like with 422 when policy disallows Bluesky, while unlike still works', async () => {
      await database.createBlueskyInteraction({
        actorId: actor.id,
        statusId,
        kind: 'like',
        uri: LIKE_URI
      })
      await database.createLike({ actorId: actor.id, statusId })

      const block = await database.createDomainBlock({
        domain: 'bsky.app',
        severity: 'suspend'
      })
      try {
        const error = await likeBlueskyPost(database, actor, statusId).catch(
          (caught: unknown) => caught
        )
        expect(blueskyInteractionFailure(error)).toEqual({
          status: 422,
          error: 'This server does not allow Bluesky.'
        })
        expect(post).not.toHaveBeenCalled()

        post.mockResolvedValue({})
        await unlikeBlueskyPost(database, actor, statusId)
        expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
          repo: OWN_DID,
          collection: 'app.bsky.feed.like',
          rkey: '3klike'
        })
        await expect(
          database.getBlueskyInteraction({
            actorId: actor.id,
            statusId,
            kind: 'like'
          })
        ).resolves.toBeNull()
        await expect(
          database.isActorLikedStatus({ actorId: actor.id, statusId })
        ).resolves.toBe(false)
      } finally {
        await database.deleteDomainBlock(block.id)
      }
    })

    it('deletes the stored like, a different leftover viewer.like, and skips re-deleting the same uri', async () => {
      const leftoverUri = `at://${OWN_DID}/app.bsky.feed.like/3kolder`
      await database.createBlueskyInteraction({
        actorId: actor.id,
        statusId,
        kind: 'like',
        uri: LIKE_URI
      })
      await database.createLike({ actorId: actor.id, statusId })
      getPosts.mockResolvedValue({
        posts: [{ viewer: { like: leftoverUri } }]
      })
      post.mockResolvedValue({})

      await unlikeBlueskyPost(database, actor, statusId)

      expect(post).toHaveBeenCalledTimes(2)
      expect(post).toHaveBeenNthCalledWith(1, 'com.atproto.repo.deleteRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.like',
        rkey: '3klike'
      })
      expect(post).toHaveBeenNthCalledWith(2, 'com.atproto.repo.deleteRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.like',
        rkey: '3kolder'
      })

      // When getPosts still lags and returns the just-deleted URI, do not delete twice.
      post.mockClear()
      getRecord.mockClear()
      await database.createBlueskyInteraction({
        actorId: actor.id,
        statusId,
        kind: 'like',
        uri: LIKE_URI
      })
      getPosts.mockResolvedValue({
        posts: [{ viewer: { like: LIKE_URI } }]
      })
      await unlikeBlueskyPost(database, actor, statusId)
      expect(getRecord).not.toHaveBeenCalled()
      expect(post).toHaveBeenCalledTimes(1)
    })

    it('tolerates RecordNotFound and skips deleteRecord for a URI in another repo', async () => {
      await database.createBlueskyInteraction({
        actorId: actor.id,
        statusId,
        kind: 'like',
        uri: LIKE_URI
      })
      await database.createLike({ actorId: actor.id, statusId })
      post.mockRejectedValueOnce(
        new BlueskyRequestError(
          'com.atproto.repo.deleteRecord',
          400,
          'RecordNotFound'
        )
      )

      await unlikeBlueskyPost(database, actor, statusId)
      await expect(
        database.isActorLikedStatus({ actorId: actor.id, statusId })
      ).resolves.toBe(false)

      // Stored URI from a previous DID after relink: skip deleteRecord, still drop local rows.
      post.mockClear()
      await database.createBlueskyInteraction({
        actorId: actor.id,
        statusId,
        kind: 'like',
        uri: 'at://did:plc:previousaaaaaaaaaaaaaaaa/app.bsky.feed.like/3kold'
      })
      await database.createLike({ actorId: actor.id, statusId })
      await unlikeBlueskyPost(database, actor, statusId)
      expect(post).not.toHaveBeenCalled()
      await expect(
        database.getBlueskyInteraction({
          actorId: actor.id,
          statusId,
          kind: 'like'
        })
      ).resolves.toBeNull()
      await expect(
        database.isActorLikedStatus({ actorId: actor.id, statusId })
      ).resolves.toBe(false)
    })

    it('deletes a remote viewer.like and local like even when no bluesky_interactions row exists', async () => {
      const externalUri = `at://${OWN_DID}/app.bsky.feed.like/3kexternal`
      await database.createLike({ actorId: actor.id, statusId })
      getPosts.mockResolvedValue({
        posts: [{ viewer: { like: externalUri } }]
      })
      post.mockResolvedValue({})

      await unlikeBlueskyPost(database, actor, statusId)

      expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.like',
        rkey: '3kexternal'
      })
      await expect(
        database.isActorLikedStatus({ actorId: actor.id, statusId })
      ).resolves.toBe(false)
    })

    it('keeps local rows when deleteRecord fails with 500', async () => {
      await database.createBlueskyInteraction({
        actorId: actor.id,
        statusId,
        kind: 'like',
        uri: LIKE_URI
      })
      await database.createLike({ actorId: actor.id, statusId })
      post.mockRejectedValue(
        new BlueskyRequestError('com.atproto.repo.deleteRecord', 500)
      )

      await expect(
        unlikeBlueskyPost(database, actor, statusId)
      ).rejects.toBeInstanceOf(BlueskyRequestError)
      await expect(
        database.getBlueskyInteraction({
          actorId: actor.id,
          statusId,
          kind: 'like'
        })
      ).resolves.not.toBeNull()
      await expect(
        database.isActorLikedStatus({ actorId: actor.id, statusId })
      ).resolves.toBe(true)
    })
  })

  describe('repostBlueskyPost and unrepostBlueskyPost', () => {
    it('creates a repost record and local-only Announce without publishing SEND_ANNOUNCE or notifications', async () => {
      post.mockResolvedValue({ uri: REPOST_URI, cid: 'bafy' })

      const announce = await repostBlueskyPost(database, actor, statusId)

      expect(post).toHaveBeenCalledWith('com.atproto.repo.createRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.repost',
        record: {
          $type: 'app.bsky.feed.repost',
          subject: { uri: postUri, cid: postCid },
          createdAt: expect.any(String)
        }
      })
      expect(announce.type).toBe(StatusType.enum.Announce)
      expect(announce.actorId).toBe(actor.id)
      expect(announce.to).toEqual([ACTIVITY_STREAM_PUBLIC])
      expect(announce.cc).toEqual([actor.id, actor.followersUrl])
      expect(timelinesService.addStatusToTimelines).toHaveBeenCalledWith(
        database,
        announce
      )
      expect(getQueue().publish).not.toHaveBeenCalled()
      await expect(
        database.getBlueskyInteraction({
          actorId: actor.id,
          statusId,
          kind: 'repost'
        })
      ).resolves.toMatchObject({ uri: REPOST_URI })
    })

    it('is idempotent when already reposted and returns the existing Announce', async () => {
      post.mockResolvedValue({ uri: REPOST_URI })
      const first = await repostBlueskyPost(database, actor, statusId)
      post.mockClear()
      get.mockClear()

      const second = await repostBlueskyPost(database, actor, statusId)

      expect(second.id).toBe(first.id)
      expect(post).not.toHaveBeenCalled()
      expect(get).not.toHaveBeenCalled()
    })

    it('adopts an existing viewer.repost without calling createRecord', async () => {
      const externalUri = `at://${OWN_DID}/app.bsky.feed.repost/3kexternal`
      getPosts.mockResolvedValue({
        posts: [{ viewer: { repost: externalUri } }]
      })

      const announce = await repostBlueskyPost(database, actor, statusId)

      expect(post).not.toHaveBeenCalled()
      expect(announce.type).toBe(StatusType.enum.Announce)
      await expect(
        database.getBlueskyInteraction({
          actorId: actor.id,
          statusId,
          kind: 'repost'
        })
      ).resolves.toMatchObject({ uri: externalUri })
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('deletes the repost record, bluesky_interactions row, and local Announce without SEND_UNDO_ANNOUNCE', async () => {
      post.mockResolvedValue({ uri: REPOST_URI })
      const announce = await repostBlueskyPost(database, actor, statusId)
      post.mockClear()
      vi.mocked(getQueue().publish).mockClear()

      post.mockResolvedValue({})
      const deleted = await unrepostBlueskyPost(database, actor, statusId)

      expect(deleted?.id).toBe(announce.id)
      expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.repost',
        rkey: '3krepost'
      })
      await expect(
        database.getBlueskyInteraction({
          actorId: actor.id,
          statusId,
          kind: 'repost'
        })
      ).resolves.toBeNull()
      await expect(
        database.getActorAnnounceStatus({ actorId: actor.id, statusId })
      ).resolves.toBeNull()
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('allows unrepost when Bluesky is disallowed by policy while refusing new reposts with 422', async () => {
      post.mockResolvedValue({ uri: REPOST_URI })
      await repostBlueskyPost(database, actor, statusId)
      post.mockClear()

      const block = await database.createDomainBlock({
        domain: 'bsky.app',
        severity: 'suspend'
      })
      try {
        const error = await repostBlueskyPost(database, actor, statusId).catch(
          (caught: unknown) => caught
        )
        expect(blueskyInteractionFailure(error)).toEqual({
          status: 422,
          error: 'This server does not allow Bluesky.'
        })

        post.mockResolvedValue({})
        await unrepostBlueskyPost(database, actor, statusId)
        expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
          repo: OWN_DID,
          collection: 'app.bsky.feed.repost',
          rkey: '3krepost'
        })
        await expect(
          database.getActorAnnounceStatus({ actorId: actor.id, statusId })
        ).resolves.toBeNull()
      } finally {
        await database.deleteDomainBlock(block.id)
      }
    })

    it('deletes a remote viewer.repost even when no bluesky_interactions row exists', async () => {
      const externalUri = `at://${OWN_DID}/app.bsky.feed.repost/3kexternal`
      getPosts.mockResolvedValue({
        posts: [{ viewer: { repost: externalUri } }]
      })
      post.mockResolvedValue({})

      await unrepostBlueskyPost(database, actor, statusId)

      expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.repost',
        rkey: '3kexternal'
      })
    })
  })

  describe('error mapping and lock timeout', () => {
    it('maps interaction lock timeouts to 409 and ignores unrelated lock timeouts', () => {
      expect(
        blueskyInteractionFailure(
          new BlueskyLockTimeoutError(
            `bluesky-interaction:${actor.id}:${statusId}:like`
          )
        )
      ).toEqual({
        status: 409,
        error:
          'Another change to this post is in progress. Try again in a moment.'
      })
      expect(
        blueskyInteractionFailure(
          new BlueskyLockTimeoutError('bluesky-app-password-refresh:did:plc:x')
        )
      ).toBeNull()
      expect(blueskyInteractionFailure(new BlueskySessionEndedError())).toEqual(
        {
          status: 422,
          error:
            'Bluesky ended this session. Link the account again in Settings.'
        }
      )
    })
  })
})
