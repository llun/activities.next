import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { getRelationship } from '@/lib/services/accounts/relationship'
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
  const get = vi.fn()
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

  const linkAccount = (did: string) =>
    database.saveBlueskyAccount({
      actorId: actor.id,
      did,
      handle: 'me.bsky.social',
      pdsUrl: 'https://pds.example.net/',
      authType: 'app_password',
      domainHandle: false
    })

  beforeEach(async () => {
    vi.mocked(getBlueskyAgent).mockReset()
    get.mockReset()
    get.mockResolvedValue({ viewer: {} })
    post.mockReset()
    vi.mocked(getBlueskyAgent).mockResolvedValue({
      did: OWN_DID,
      pdsUrl: 'https://pds.example.net/',
      get,
      post
    } as unknown as BlueskyAgent)
    await linkAccount(OWN_DID)
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

  it('adopts an existing follow in the user repo without calling createRecord', async () => {
    const externalUri = `at://${OWN_DID}/app.bsky.graph.follow/3kexternal`
    get.mockResolvedValue({ viewer: { following: externalUri } })

    const follow = await followBlueskyActor(database, actor, TARGET_ID)

    expect(get).toHaveBeenCalledWith('app.bsky.actor.getProfile', {
      actor: TARGET_DID
    })
    expect(post).not.toHaveBeenCalled()
    expect(follow).toMatchObject({
      actorId: actor.id,
      targetActorId: TARGET_ID,
      uri: externalUri
    })
    expect(
      await database.getBlueskyFollow({
        actorId: actor.id,
        targetActorId: TARGET_ID
      })
    ).toMatchObject({ uri: externalUri })
    expect(
      await getRelationship({
        database,
        currentActor: actor,
        targetActorId: TARGET_ID
      })
    ).toMatchObject({ following: true })
  })

  it('ignores a viewer.following URI in another repo and writes a record', async () => {
    get.mockResolvedValue({
      viewer: {
        following: 'at://did:plc:someone/app.bsky.graph.follow/3kother'
      }
    })
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
    expect(follow.uri).toBe(FOLLOW_URI)
  })

  it('refuses adoption when the account was relinked to another DID during getProfile', async () => {
    get.mockImplementation(async () => {
      await linkAccount('did:plc:relinked')
      return {
        viewer: {
          following: `at://${OWN_DID}/app.bsky.graph.follow/3kexternal`
        }
      }
    })

    await expect(
      followBlueskyActor(database, actor, TARGET_ID)
    ).rejects.toBeInstanceOf(BlueskySessionChangedError)
    expect(post).not.toHaveBeenCalled()
    expect(
      await database.getBlueskyFollow({
        actorId: actor.id,
        targetActorId: TARGET_ID
      })
    ).toBeNull()
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

  it('refuses a follow when the account was relinked to another DID during the call', async () => {
    post.mockImplementation(async () => {
      // The user relinks to another DID while createRecord is in flight.
      await linkAccount('did:plc:relinked')
      return { uri: FOLLOW_URI }
    })

    const error = await followBlueskyActor(database, actor, TARGET_ID).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(BlueskySessionChangedError)
    expect(
      await database.getBlueskyFollow({
        actorId: actor.id,
        targetActorId: TARGET_ID
      })
    ).toBeNull()
  })

  it('refuses a follow when the account was unlinked during the call', async () => {
    post.mockImplementation(async () => {
      // The user unlinks the account while createRecord is in flight.
      await database.deleteBlueskyAccount({ actorId: actor.id })
      return { uri: FOLLOW_URI }
    })

    const error = await followBlueskyActor(database, actor, TARGET_ID).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(BlueskyFollowError)
    expect(error).not.toBeInstanceOf(BlueskySessionChangedError)
    expect((error as Error).message).toBe(
      'Link a Bluesky account in Settings › Other networks to follow Bluesky accounts.'
    )
    expect(
      await database.getBlueskyFollow({
        actorId: actor.id,
        targetActorId: TARGET_ID
      })
    ).toBeNull()
  })

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

  it('deletes a Bluesky follow on unfollow even when no local row exists', async () => {
    get.mockResolvedValue({
      viewer: { following: `at://${OWN_DID}/app.bsky.graph.follow/3kexternal` }
    })
    post.mockResolvedValue({})

    await unfollowBlueskyActor(database, actor, TARGET_ID)

    expect(get).toHaveBeenCalledWith('app.bsky.actor.getProfile', {
      actor: TARGET_DID
    })
    expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
      repo: OWN_DID,
      collection: 'app.bsky.graph.follow',
      rkey: '3kexternal'
    })
  })

  it('deletes both the stored record and a different leftover follow record on unfollow', async () => {
    await database.createBlueskyFollow({
      actorId: actor.id,
      targetActorId: TARGET_ID,
      uri: FOLLOW_URI
    })
    get.mockResolvedValue({
      viewer: { following: `at://${OWN_DID}/app.bsky.graph.follow/3kolder` }
    })
    post.mockResolvedValue({})

    await unfollowBlueskyActor(database, actor, TARGET_ID)

    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenNthCalledWith(1, 'com.atproto.repo.deleteRecord', {
      repo: OWN_DID,
      collection: 'app.bsky.graph.follow',
      rkey: '3kfollow'
    })
    expect(post).toHaveBeenNthCalledWith(2, 'com.atproto.repo.deleteRecord', {
      repo: OWN_DID,
      collection: 'app.bsky.graph.follow',
      rkey: '3kolder'
    })
    expect(
      await database.getBlueskyFollow({
        actorId: actor.id,
        targetActorId: TARGET_ID
      })
    ).toBeNull()
  })

  it('does not delete the same record twice when getProfile still reports it after deletion', async () => {
    await database.createBlueskyFollow({
      actorId: actor.id,
      targetActorId: TARGET_ID,
      uri: FOLLOW_URI
    })
    get.mockResolvedValue({ viewer: { following: FOLLOW_URI } })
    post.mockResolvedValue({})

    await unfollowBlueskyActor(database, actor, TARGET_ID)

    expect(post).toHaveBeenCalledTimes(1)
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
