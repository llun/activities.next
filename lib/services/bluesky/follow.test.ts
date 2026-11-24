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
  BlueskyFollowError,
  blueskyFollowFailure,
  followBlueskyActor,
  unfollowBlueskyActor
} from '@/lib/services/bluesky/follow'
import { blueskyActorId } from '@/lib/services/bluesky/records'
import type { Actor } from '@/lib/types/domain/actor'

vi.mock('@/lib/services/bluesky/agent', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBlueskyAgent: vi.fn()
}))

const OWN_DID = 'did:plc:me'
const TARGET_DID = 'did:plc:target'
const TARGET_ID = blueskyActorId(TARGET_DID)
const FOLLOW_URI = `at://${OWN_DID}/app.bsky.graph.follow/3kfollow`
const actor = { id: 'actor-follower', domain: 'social.example' } as Actor

describe('Bluesky follow service', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const post = vi.fn()

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    for (const [did, handle] of [
      [TARGET_DID, 'target.bsky.social'],
      [OWN_DID, 'me.bsky.social']
    ]) {
      await database.upsertBlueskyActor({ did, handle })
    }
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    vi.mocked(getBlueskyAgent).mockReset()
    post.mockReset()
    vi.mocked(getBlueskyAgent).mockResolvedValue({
      did: OWN_DID,
      pdsUrl: 'https://pds.example.net/',
      get: vi.fn(),
      post
    } as unknown as BlueskyAgent)
    await database.deleteBlueskyFollow({
      actorId: actor.id,
      targetActorId: TARGET_ID
    })
  })

  it('creates a follow record and stores its uri', async () => {
    post.mockResolvedValue({ uri: FOLLOW_URI, cid: 'bafy' })

    const follow = await followBlueskyActor(database, actor, TARGET_ID)

    expect(post).toHaveBeenCalledWith('com.atproto.repo.createRecord', {
      repo: OWN_DID,
      collection: 'app.bsky.graph.follow',
      record: {
        $type: 'app.bsky.graph.follow',
        subject: TARGET_DID,
        createdAt: expect.any(String)
      }
    })
    expect(follow).toMatchObject({
      actorId: actor.id,
      targetActorId: TARGET_ID,
      uri: FOLLOW_URI
    })
  })

  it('returns the stored follow without writing another record', async () => {
    await database.createBlueskyFollow({
      actorId: actor.id,
      targetActorId: TARGET_ID,
      uri: FOLLOW_URI
    })

    const follow = await followBlueskyActor(database, actor, TARGET_ID)

    expect(follow.uri).toBe(FOLLOW_URI)
    expect(post).not.toHaveBeenCalled()
  })

  it('writes one record when the same follow is sent twice at once', async () => {
    post.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ uri: FOLLOW_URI }), 50)
        )
    )

    const [first, second] = await Promise.all([
      followBlueskyActor(database, actor, TARGET_ID),
      followBlueskyActor(database, actor, TARGET_ID)
    ])

    expect(post).toHaveBeenCalledTimes(1)
    expect(first.uri).toBe(FOLLOW_URI)
    expect(second.uri).toBe(FOLLOW_URI)
  })

  it.each([
    ['another repo', `at://did:plc:someone/app.bsky.graph.follow/3kfollow`],
    ['another collection', `at://${OWN_DID}/app.bsky.feed.like/3kfollow`],
    ['no uri', undefined]
  ])(
    'refuses a createRecord answer naming %s and stores nothing',
    async (_label, uri) => {
      post.mockResolvedValue({ uri })

      await expect(
        followBlueskyActor(database, actor, TARGET_ID)
      ).rejects.toThrow('Bluesky createRecord gave an unexpected answer')
      expect(
        await database.getBlueskyFollow({
          actorId: actor.id,
          targetActorId: TARGET_ID
        })
      ).toBeNull()
    }
  )

  it('refuses a follow without a linked account', async () => {
    vi.mocked(getBlueskyAgent).mockResolvedValue(null)

    await expect(
      followBlueskyActor(database, actor, TARGET_ID)
    ).rejects.toThrow(
      'Link a Bluesky account in Settings › Other networks to follow Bluesky accounts.'
    )
  })

  it('refuses to follow the linked account itself', async () => {
    await expect(
      followBlueskyActor(database, actor, blueskyActorId(OWN_DID))
    ).rejects.toBeInstanceOf(BlueskyFollowError)
    expect(post).not.toHaveBeenCalled()
  })

  it('refuses a post id or an unknown account', async () => {
    for (const id of [
      `${TARGET_ID}/post/3kpost`,
      blueskyActorId('did:plc:unknown')
    ]) {
      await expect(
        followBlueskyActor(database, actor, id)
      ).rejects.toMatchObject({ status: 404 })
    }
  })

  it('deletes the record and the row on unfollow', async () => {
    await database.createBlueskyFollow({
      actorId: actor.id,
      targetActorId: TARGET_ID,
      uri: FOLLOW_URI
    })
    post.mockResolvedValue({})

    await unfollowBlueskyActor(database, actor, TARGET_ID)

    expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
      repo: OWN_DID,
      collection: 'app.bsky.graph.follow',
      rkey: '3kfollow'
    })
    expect(
      await database.getBlueskyFollow({
        actorId: actor.id,
        targetActorId: TARGET_ID
      })
    ).toBeNull()
  })

  it('drops the row without calling Bluesky when the record is in another repo', async () => {
    await database.createBlueskyFollow({
      actorId: actor.id,
      targetActorId: TARGET_ID,
      uri: 'at://did:plc:previous/app.bsky.graph.follow/3kfollow'
    })

    await unfollowBlueskyActor(database, actor, TARGET_ID)

    expect(post).not.toHaveBeenCalled()
    expect(
      await database.getBlueskyFollow({
        actorId: actor.id,
        targetActorId: TARGET_ID
      })
    ).toBeNull()
  })

  it('drops the row when the record is already gone', async () => {
    await database.createBlueskyFollow({
      actorId: actor.id,
      targetActorId: TARGET_ID,
      uri: FOLLOW_URI
    })
    post.mockRejectedValue(
      new BlueskyRequestError(
        'com.atproto.repo.deleteRecord',
        400,
        'RecordNotFound'
      )
    )

    await unfollowBlueskyActor(database, actor, TARGET_ID)

    expect(
      await database.getBlueskyFollow({
        actorId: actor.id,
        targetActorId: TARGET_ID
      })
    ).toBeNull()
  })

  it('keeps the row when Bluesky refuses the delete', async () => {
    await database.createBlueskyFollow({
      actorId: actor.id,
      targetActorId: TARGET_ID,
      uri: FOLLOW_URI
    })
    post.mockRejectedValue(
      new BlueskyRequestError('com.atproto.repo.deleteRecord', 500)
    )

    await expect(
      unfollowBlueskyActor(database, actor, TARGET_ID)
    ).rejects.toBeInstanceOf(BlueskyRequestError)
    expect(
      await database.getBlueskyFollow({
        actorId: actor.id,
        targetActorId: TARGET_ID
      })
    ).not.toBeNull()
  })

  it('maps the typed errors to route answers', () => {
    expect(blueskyFollowFailure(new BlueskySessionEndedError())).toEqual({
      status: 422,
      error: 'Bluesky ended this session. Link the account again in Settings.'
    })
    expect(blueskyFollowFailure(new BlueskyFollowError('No'))).toEqual({
      status: 422,
      error: 'No'
    })
    expect(blueskyFollowFailure(new BlueskySessionChangedError())).toEqual({
      status: 409,
      error: 'Your Bluesky account was just linked again. Try again.'
    })
    expect(blueskyFollowFailure(new Error('boom'))).toBeNull()
    // A session-refresh lock timing out is not a follow change in progress.
    expect(
      blueskyFollowFailure(new BlueskyLockTimeoutError('refresh:did:plc:me'))
    ).toBeNull()
  })

  it('answers 409 when the follow lock stays held past the wait', async () => {
    vi.spyOn(database, 'acquireImportLock').mockResolvedValue(null)
    const start = Date.now()
    // The first read sets the deadline; every later one is past it.
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(start)
      .mockReturnValue(start + 60_000)

    try {
      const error = await followBlueskyActor(database, actor, TARGET_ID).catch(
        (caught: unknown) => caught
      )

      expect(error).toBeInstanceOf(BlueskyLockTimeoutError)
      expect(blueskyFollowFailure(error)).toEqual({
        status: 409,
        error:
          'Another follow change for this account is in progress. Try again in a moment.'
      })
      expect(post).not.toHaveBeenCalled()
    } finally {
      vi.restoreAllMocks()
    }
  })
})
