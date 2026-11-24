import { IdempotencyConflictError } from '@/lib/database/domains/idempotency/types'
import { APP_RATE_LIMIT_KEY_PREFIX } from '@/lib/database/domains/rateLimit/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { BlueskyActionError } from '@/lib/services/bluesky/actionErrors'
import {
  type BlueskyAgent,
  BlueskyRequestError,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import {
  getPublicPosts,
  getPublicProfiles
} from '@/lib/services/bluesky/appview'
import {
  BLUESKY_NOT_ALLOWED_MESSAGE,
  isBlueskyAllowed
} from '@/lib/services/bluesky/policy'
import { blueskyActorId, blueskyPostId } from '@/lib/services/bluesky/records'
import {
  BLUESKY_REPLY_RATE_LIMIT,
  BLUESKY_REPLY_RATE_LIMIT_MESSAGE,
  BlueskyReplyRateLimitError,
  deleteOwnBlueskyPost,
  replyToBlueskyPost
} from '@/lib/services/bluesky/reply'
import type { Actor } from '@/lib/types/domain/actor'

vi.mock('@/lib/services/bluesky/agent', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBlueskyAgent: vi.fn()
}))

vi.mock('@/lib/services/bluesky/appview', () => ({
  getPublicPosts: vi.fn(),
  getPublicProfiles: vi.fn()
}))

vi.mock('@/lib/services/bluesky/policy', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isBlueskyAllowed: vi.fn()
}))

const OWN_DID = `did:plc:${'a'.repeat(24)}`
const PARENT_DID = `did:plc:${'b'.repeat(24)}`
const ROOT_DID = `did:plc:${'c'.repeat(24)}`

const PARENT_RKEY = '3kparent'
const PARENT_URI = `at://${PARENT_DID}/app.bsky.feed.post/${PARENT_RKEY}`
const PARENT_CID = `bafyrei${'p'.repeat(52)}`
const APPVIEW_PARENT_CID = `bafyrei${'q'.repeat(52)}`

const ROOT_URI = `at://${ROOT_DID}/app.bsky.feed.post/3kroot`
const ROOT_CID = `bafyrei${'r'.repeat(52)}`

const REPLY_RKEY = '3kreply1'
const REPLY_URI = `at://${OWN_DID}/app.bsky.feed.post/${REPLY_RKEY}`
const REPLY_CID = `bafyrei${'s'.repeat(52)}`

const actor = { id: 'actor-replier', domain: 'social.example' } as Actor
const noWait = vi.fn().mockResolvedValue(undefined)

const makePostView = ({
  uri,
  cid,
  did,
  handle,
  text,
  reply,
  facets
}: {
  uri: string
  cid: string
  did: string
  handle: string
  text: string
  reply?: {
    root: { uri: string; cid: string }
    parent: { uri: string; cid: string }
  }
  facets?: unknown[]
}) => ({
  uri,
  cid,
  author: {
    did,
    handle,
    displayName: handle
  },
  record: {
    $type: 'app.bsky.feed.post',
    text,
    ...(facets ? { facets } : {}),
    ...(reply ? { reply } : {}),
    createdAt: '2026-11-24T07:00:00.000Z'
  },
  indexedAt: '2026-11-24T07:00:01.000Z'
})

describe('Bluesky reply & delete service', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const post = vi.fn()
  const get = vi.fn()
  let parentStatusId = ''

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    const parentActorId = (await database.upsertBlueskyActor({
      did: PARENT_DID,
      handle: 'parent.bsky.social'
    })) as string
    const stored = await database.upsertBlueskyPost({
      uri: PARENT_URI,
      cid: PARENT_CID,
      did: PARENT_DID,
      rkey: PARENT_RKEY,
      actorId: parentActorId,
      text: '<p>Parent post</p>',
      createdAt: Date.now() - 1000,
      attachments: []
    })
    parentStatusId = stored.statusId
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
    vi.mocked(isBlueskyAllowed).mockReset()
    vi.mocked(isBlueskyAllowed).mockResolvedValue(true)
    vi.mocked(getBlueskyAgent).mockReset()
    vi.mocked(getPublicPosts).mockReset()
    vi.mocked(getPublicProfiles).mockReset()
    post.mockReset()
    get.mockReset()
    noWait.mockClear()

    vi.mocked(getBlueskyAgent).mockResolvedValue({
      did: OWN_DID,
      pdsUrl: 'https://pds.example.net/',
      get,
      post
    } as unknown as BlueskyAgent)
    vi.mocked(getPublicProfiles).mockResolvedValue([])
    await database.deleteRateLimits({
      keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
      before: Date.now() + 24 * 60 * 60 * 1000
    })
    await linkAccount(OWN_DID)
    // Remove any previously stored reply row.
    await database.deleteStatus({
      statusId: blueskyPostId(OWN_DID, REPLY_RKEY),
      actorId: blueskyActorId(OWN_DID)
    })
  })

  describe('replyToBlueskyPost validation', () => {
    it('refuses when Bluesky is not allowed by server policy', async () => {
      vi.mocked(isBlueskyAllowed).mockResolvedValue(false)

      await expect(
        replyToBlueskyPost(database, actor, {
          parentStatusId,
          text: 'Hello'
        })
      ).rejects.toMatchObject({
        status: 422,
        message: BLUESKY_NOT_ALLOWED_MESSAGE
      })
      expect(post).not.toHaveBeenCalled()
    })

    it('refuses when actor has no linked Bluesky account', async () => {
      vi.mocked(getBlueskyAgent).mockResolvedValue(null)

      await expect(
        replyToBlueskyPost(database, actor, {
          parentStatusId,
          text: 'Hello'
        })
      ).rejects.toMatchObject({
        status: 422,
        message:
          'Link a Bluesky account in Settings › Other networks to reply to Bluesky posts.'
      })
    })

    it.each(['private', 'direct'])(
      'refuses %s visibility with 422',
      async (visibility) => {
        await expect(
          replyToBlueskyPost(database, actor, {
            parentStatusId,
            text: 'Hello',
            visibility
          })
        ).rejects.toMatchObject({
          status: 422,
          message:
            'Replies to Bluesky posts are public: Bluesky has no followers-only or direct posts.'
        })
      }
    )

    it('refuses media attachments with 422', async () => {
      await expect(
        replyToBlueskyPost(database, actor, {
          parentStatusId,
          text: 'Hello',
          mediaIds: ['media-1']
        })
      ).rejects.toMatchObject({
        status: 422,
        message: 'Images in Bluesky replies are not supported yet.'
      })
    })

    it('refuses polls, content warnings, empty text, and >300 graphemes', async () => {
      await expect(
        replyToBlueskyPost(database, actor, {
          parentStatusId,
          text: 'Hello',
          poll: { options: ['a', 'b'], expires_in: 300 }
        })
      ).rejects.toBeInstanceOf(BlueskyActionError)

      await expect(
        replyToBlueskyPost(database, actor, {
          parentStatusId,
          text: 'Hello',
          spoilerText: 'Spoiler'
        })
      ).rejects.toBeInstanceOf(BlueskyActionError)

      await expect(
        replyToBlueskyPost(database, actor, {
          parentStatusId,
          text: '   '
        })
      ).rejects.toBeInstanceOf(BlueskyActionError)

      await expect(
        replyToBlueskyPost(database, actor, {
          parentStatusId,
          text: 'a'.repeat(301)
        })
      ).rejects.toMatchObject({
        status: 422,
        message: 'Bluesky allows 300 characters. Shorten the reply to post it.'
      })
    })

    it('counts graphemes so 300 emoji within 3000 UTF-8 bytes are accepted, and rejects over 3000 UTF-8 bytes', async () => {
      await expect(
        replyToBlueskyPost(database, actor, {
          parentStatusId,
          // 121 ZWJ family emoji = 121 graphemes (<= 300), but 3025 UTF-8 bytes (> 3000).
          text: '👨‍👩‍👧‍👦'.repeat(121)
        })
      ).rejects.toMatchObject({
        status: 422,
        message: 'Bluesky allows 300 characters. Shorten the reply to post it.'
      })
      expect(post).not.toHaveBeenCalled()

      const emojiText = '🚀'.repeat(300)
      vi.mocked(getPublicPosts)
        .mockResolvedValueOnce([
          makePostView({
            uri: PARENT_URI,
            cid: PARENT_CID,
            did: PARENT_DID,
            handle: 'parent.bsky.social',
            text: 'Parent'
          })
        ])
        .mockResolvedValueOnce([
          makePostView({
            uri: REPLY_URI,
            cid: REPLY_CID,
            did: OWN_DID,
            handle: 'me.bsky.social',
            text: emojiText,
            reply: {
              root: { uri: PARENT_URI, cid: PARENT_CID },
              parent: { uri: PARENT_URI, cid: PARENT_CID }
            }
          })
        ])
      post.mockResolvedValue({ uri: REPLY_URI, cid: REPLY_CID })

      const result = await replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: emojiText },
        { wait: noWait }
      )
      expect(result).toEqual({
        stored: true,
        statusId: blueskyPostId(OWN_DID, REPLY_RKEY)
      })
    })

    it('rewrites @<handle>@bsky.app mentions before counting graphemes and building facets', async () => {
      vi.mocked(getPublicProfiles).mockResolvedValue([
        { did: PARENT_DID, handle: 'parent.bsky.social' }
      ])
      // 28 chars for `@parent.bsky.social@bsky.app` + 1 space + 280 'a' = 309 graphemes before rewrite,
      // 19 chars for `@parent.bsky.social` + 1 space + 280 'a' = 300 graphemes after rewrite.
      const rawText = `@parent.bsky.social@bsky.app ${'a'.repeat(280)}`
      const rewrittenText = `@parent.bsky.social ${'a'.repeat(280)}`
      vi.mocked(getPublicPosts)
        .mockResolvedValueOnce([
          makePostView({
            uri: PARENT_URI,
            cid: PARENT_CID,
            did: PARENT_DID,
            handle: 'parent.bsky.social',
            text: 'Parent'
          })
        ])
        .mockResolvedValueOnce([
          makePostView({
            uri: REPLY_URI,
            cid: REPLY_CID,
            did: OWN_DID,
            handle: 'me.bsky.social',
            text: rewrittenText,
            reply: {
              root: { uri: PARENT_URI, cid: PARENT_CID },
              parent: { uri: PARENT_URI, cid: PARENT_CID }
            }
          })
        ])
      post.mockResolvedValue({ uri: REPLY_URI, cid: REPLY_CID })

      const result = await replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: rawText },
        { wait: noWait }
      )
      expect(result).toEqual({
        stored: true,
        statusId: blueskyPostId(OWN_DID, REPLY_RKEY)
      })
      expect(post).toHaveBeenCalledWith(
        'com.atproto.repo.createRecord',
        expect.objectContaining({
          record: expect.objectContaining({
            text: rewrittenText,
            facets: [
              {
                index: { byteStart: 0, byteEnd: '@parent.bsky.social'.length },
                features: [
                  {
                    $type: 'app.bsky.richtext.facet#mention',
                    did: PARENT_DID
                  }
                ]
              }
            ]
          })
        })
      )
    })

    it('enforces a per-actor reply rate limit before AppView reads and throws 429', async () => {
      vi.mocked(getPublicPosts).mockResolvedValue([])
      for (let i = 0; i < BLUESKY_REPLY_RATE_LIMIT.limit; i += 1) {
        await expect(
          replyToBlueskyPost(database, actor, {
            parentStatusId,
            text: 'Hello'
          })
        ).rejects.toBeInstanceOf(BlueskyActionError)
      }
      expect(getPublicPosts).toHaveBeenCalledTimes(
        BLUESKY_REPLY_RATE_LIMIT.limit
      )

      await expect(
        replyToBlueskyPost(database, actor, {
          parentStatusId,
          text: 'One too many'
        })
      ).rejects.toMatchObject({
        name: BlueskyReplyRateLimitError.name,
        status: 429,
        message: BLUESKY_REPLY_RATE_LIMIT_MESSAGE
      })
      // Did not hit AppView on the rate-limited attempt.
      expect(getPublicPosts).toHaveBeenCalledTimes(
        BLUESKY_REPLY_RATE_LIMIT.limit
      )
    })

    it('returns 404 when the parent is not a stored Bluesky post with a bluesky_records row', async () => {
      await expect(
        replyToBlueskyPost(database, actor, {
          parentStatusId: 'https://bsky.app/profile/did:plc:missing/post/nope',
          text: 'Hello'
        })
      ).rejects.toMatchObject({ status: 404 })
    })

    it('refuses when AppView does not return the parent post', async () => {
      vi.mocked(getPublicPosts).mockResolvedValue([])

      await expect(
        replyToBlueskyPost(database, actor, {
          parentStatusId,
          text: 'Hello'
        })
      ).rejects.toMatchObject({
        status: 422,
        message: 'Bluesky could not find the post you are replying to.'
      })
      expect(post).not.toHaveBeenCalled()
    })
  })

  describe('replyToBlueskyPost publishing and readback', () => {
    it('creates a reply to a root post with facets and langs and stores the AppView readback', async () => {
      vi.mocked(getPublicProfiles).mockResolvedValue([
        { did: PARENT_DID, handle: 'parent.bsky.social' }
      ])
      vi.mocked(getPublicPosts)
        .mockResolvedValueOnce([
          makePostView({
            uri: PARENT_URI,
            cid: PARENT_CID,
            did: PARENT_DID,
            handle: 'parent.bsky.social',
            text: 'Parent post'
          })
        ])
        .mockResolvedValueOnce([
          makePostView({
            uri: REPLY_URI,
            cid: REPLY_CID,
            did: OWN_DID,
            handle: 'me.bsky.social',
            text: 'Hi @parent.bsky.social #test https://example.com',
            reply: {
              root: { uri: PARENT_URI, cid: PARENT_CID },
              parent: { uri: PARENT_URI, cid: PARENT_CID }
            }
          })
        ])
      post.mockResolvedValue({ uri: REPLY_URI, cid: REPLY_CID })

      const result = await replyToBlueskyPost(
        database,
        actor,
        {
          parentStatusId,
          text: 'Hi @parent.bsky.social #test https://example.com',
          visibility: 'unlisted',
          language: 'en'
        },
        { wait: noWait }
      )

      expect(result).toEqual({
        stored: true,
        statusId: blueskyPostId(OWN_DID, REPLY_RKEY)
      })
      const statusId = result.stored ? result.statusId : ''
      expect(post).toHaveBeenCalledWith('com.atproto.repo.createRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.post',
        record: expect.objectContaining({
          $type: 'app.bsky.feed.post',
          text: 'Hi @parent.bsky.social #test https://example.com',
          langs: ['en'],
          reply: {
            root: { uri: PARENT_URI, cid: PARENT_CID },
            parent: { uri: PARENT_URI, cid: PARENT_CID }
          },
          facets: expect.arrayContaining([
            expect.objectContaining({
              features: [
                { $type: 'app.bsky.richtext.facet#mention', did: PARENT_DID }
              ]
            }),
            expect.objectContaining({
              features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'test' }]
            }),
            expect.objectContaining({
              features: [
                {
                  $type: 'app.bsky.richtext.facet#link',
                  uri: 'https://example.com'
                }
              ]
            })
          ])
        })
      })

      const stored = await database.getStatus({ statusId })
      expect(stored).not.toBeNull()
      expect(stored?.network).toBe('bluesky')
      expect(stored?.actorId).toBe(blueskyActorId(OWN_DID))
      if (stored && stored.type === 'Note') {
        expect(stored.reply).toBe(parentStatusId)
      }
      const recordRow = await database.getBlueskyRecordByStatusId({ statusId })
      expect(recordRow).toMatchObject({ uri: REPLY_URI, cid: REPLY_CID })
    })

    it('uses the parent post reply.root when replying to a reply', async () => {
      vi.mocked(getPublicPosts)
        .mockResolvedValueOnce([
          makePostView({
            uri: PARENT_URI,
            cid: PARENT_CID,
            did: PARENT_DID,
            handle: 'parent.bsky.social',
            text: 'Child post',
            reply: {
              root: { uri: ROOT_URI, cid: ROOT_CID },
              parent: { uri: ROOT_URI, cid: ROOT_CID }
            }
          })
        ])
        .mockResolvedValueOnce([
          makePostView({
            uri: REPLY_URI,
            cid: REPLY_CID,
            did: OWN_DID,
            handle: 'me.bsky.social',
            text: 'Nested reply',
            reply: {
              root: { uri: ROOT_URI, cid: ROOT_CID },
              parent: { uri: PARENT_URI, cid: PARENT_CID }
            }
          })
        ])
      post.mockResolvedValue({ uri: REPLY_URI, cid: REPLY_CID })

      await replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: 'Nested reply' },
        { wait: noWait }
      )

      expect(post).toHaveBeenCalledWith(
        'com.atproto.repo.createRecord',
        expect.objectContaining({
          record: expect.objectContaining({
            reply: {
              root: { uri: ROOT_URI, cid: ROOT_CID },
              parent: { uri: PARENT_URI, cid: PARENT_CID }
            }
          })
        })
      )
    })

    it('uses parentView.cid from AppView rather than the stored bluesky_records cid', async () => {
      vi.mocked(getPublicPosts)
        .mockResolvedValueOnce([
          makePostView({
            uri: PARENT_URI,
            cid: APPVIEW_PARENT_CID,
            did: PARENT_DID,
            handle: 'parent.bsky.social',
            text: 'Parent with fresher AppView cid'
          })
        ])
        .mockResolvedValueOnce([
          makePostView({
            uri: REPLY_URI,
            cid: REPLY_CID,
            did: OWN_DID,
            handle: 'me.bsky.social',
            text: 'Reply using AppView parent cid',
            reply: {
              root: { uri: PARENT_URI, cid: APPVIEW_PARENT_CID },
              parent: { uri: PARENT_URI, cid: APPVIEW_PARENT_CID }
            }
          })
        ])
      post.mockResolvedValue({ uri: REPLY_URI, cid: REPLY_CID })

      await replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: 'Reply using AppView parent cid' },
        { wait: noWait }
      )

      expect(post).toHaveBeenCalledWith(
        'com.atproto.repo.createRecord',
        expect.objectContaining({
          record: expect.objectContaining({
            reply: {
              root: { uri: PARENT_URI, cid: APPVIEW_PARENT_CID },
              parent: { uri: PARENT_URI, cid: APPVIEW_PARENT_CID }
            }
          })
        })
      )
    })

    it('retries AppView readback 3 times then stores nothing and signals posted-not-stored without calling getPublicProfiles', async () => {
      vi.mocked(getPublicPosts)
        .mockResolvedValueOnce([
          makePostView({
            uri: PARENT_URI,
            cid: PARENT_CID,
            did: PARENT_DID,
            handle: 'parent.bsky.social',
            text: 'Parent'
          })
        ])
        // Initial readback + 3 retries all miss
        .mockResolvedValue([])
      post.mockResolvedValue({ uri: REPLY_URI, cid: REPLY_CID })

      const result = await replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: 'Lagging reply' },
        { wait: noWait }
      )

      // 1 parent lookup + 4 readback attempts = 5 calls; 3 waits between retries.
      expect(getPublicPosts).toHaveBeenCalledTimes(5)
      expect(noWait).toHaveBeenCalledTimes(3)
      expect(getPublicProfiles).not.toHaveBeenCalled()
      expect(result).toEqual({ stored: false })

      expect(
        await database.getStatus({
          statusId: blueskyPostId(OWN_DID, REPLY_RKEY)
        })
      ).toBeNull()
    })

    it('stores nothing and signals posted-not-stored without throwing if the actor relinked mid-request', async () => {
      vi.mocked(getPublicPosts)
        .mockResolvedValueOnce([
          makePostView({
            uri: PARENT_URI,
            cid: PARENT_CID,
            did: PARENT_DID,
            handle: 'parent.bsky.social',
            text: 'Parent'
          })
        ])
        .mockResolvedValueOnce([
          makePostView({
            uri: REPLY_URI,
            cid: REPLY_CID,
            did: OWN_DID,
            handle: 'me.bsky.social',
            text: 'Relink race',
            reply: {
              root: { uri: PARENT_URI, cid: PARENT_CID },
              parent: { uri: PARENT_URI, cid: PARENT_CID }
            }
          })
        ])
      post.mockImplementation(async () => {
        await linkAccount(`did:plc:${'z'.repeat(24)}`)
        return { uri: REPLY_URI, cid: REPLY_CID }
      })

      const result = await replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: 'Relink race' },
        { wait: noWait }
      )

      expect(result).toEqual({ stored: false })
      expect(
        await database.getStatus({
          statusId: blueskyPostId(OWN_DID, REPLY_RKEY)
        })
      ).toBeNull()
    })

    it('treats an invalid createRecord cid or mismatched repo URI as posted-not-stored without storing or throwing', async () => {
      vi.mocked(getPublicPosts).mockResolvedValueOnce([
        makePostView({
          uri: PARENT_URI,
          cid: PARENT_CID,
          did: PARENT_DID,
          handle: 'parent.bsky.social',
          text: 'Parent'
        })
      ])
      post.mockResolvedValueOnce({
        uri: REPLY_URI,
        cid: 'not-a-valid-cid'
      })

      const badCid = await replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: 'Bad cid' },
        { wait: noWait }
      )
      expect(badCid).toEqual({ stored: false })
      expect(getPublicPosts).toHaveBeenCalledTimes(1)
      expect(
        await database.getStatus({
          statusId: blueskyPostId(OWN_DID, REPLY_RKEY)
        })
      ).toBeNull()

      vi.mocked(getPublicPosts).mockResolvedValueOnce([
        makePostView({
          uri: PARENT_URI,
          cid: PARENT_CID,
          did: PARENT_DID,
          handle: 'parent.bsky.social',
          text: 'Parent'
        })
      ])
      post.mockResolvedValueOnce({
        uri: `at://${PARENT_DID}/app.bsky.feed.post/hijack`,
        cid: REPLY_CID
      })

      const badUri = await replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: 'Hijacked uri' },
        { wait: noWait }
      )
      expect(badUri).toEqual({ stored: false })
      expect(
        await database.getStatus({
          statusId: blueskyPostId(PARENT_DID, 'hijack')
        })
      ).toBeNull()
    })
  })

  describe('deleteOwnBlueskyPost', () => {
    const storeOwnPost = async () => {
      const ownActorId = (await database.upsertBlueskyActor({
        did: OWN_DID,
        handle: 'me.bsky.social'
      })) as string
      const { statusId } = await database.upsertBlueskyPost({
        uri: REPLY_URI,
        cid: REPLY_CID,
        did: OWN_DID,
        rkey: REPLY_RKEY,
        actorId: ownActorId,
        text: '<p>My reply</p>',
        createdAt: Date.now(),
        replyToStatusId: parentStatusId,
        attachments: []
      })
      return statusId
    }

    it('deletes the record on the PDS and removes the local status row', async () => {
      const ownStatusId = await storeOwnPost()
      post.mockResolvedValue({})

      await deleteOwnBlueskyPost(database, actor, ownStatusId)

      expect(post).toHaveBeenCalledWith('com.atproto.repo.deleteRecord', {
        repo: OWN_DID,
        collection: 'app.bsky.feed.post',
        rkey: REPLY_RKEY
      })
      expect(await database.getStatus({ statusId: ownStatusId })).toBeNull()
    })

    it('tolerates RecordNotFound from the PDS and still deletes the local row', async () => {
      const ownStatusId = await storeOwnPost()
      post.mockRejectedValue(
        new BlueskyRequestError(
          'com.atproto.repo.deleteRecord',
          400,
          'RecordNotFound'
        )
      )

      await deleteOwnBlueskyPost(database, actor, ownStatusId)

      expect(await database.getStatus({ statusId: ownStatusId })).toBeNull()
    })

    it('propagates non-RecordNotFound PDS errors and keeps the local row', async () => {
      const ownStatusId = await storeOwnPost()
      post.mockRejectedValue(
        new BlueskyRequestError('com.atproto.repo.deleteRecord', 503)
      )

      await expect(
        deleteOwnBlueskyPost(database, actor, ownStatusId)
      ).rejects.toBeInstanceOf(BlueskyRequestError)
      expect(await database.getStatus({ statusId: ownStatusId })).not.toBeNull()
    })

    it('refuses to delete another Bluesky account post', async () => {
      await expect(
        deleteOwnBlueskyPost(database, actor, parentStatusId)
      ).rejects.toBeInstanceOf(BlueskyActionError)
      expect(post).not.toHaveBeenCalled()
      expect(
        await database.getStatus({ statusId: parentStatusId })
      ).not.toBeNull()
    })

    it('refuses when Bluesky is not allowed by policy', async () => {
      const ownStatusId = await storeOwnPost()
      vi.mocked(isBlueskyAllowed).mockResolvedValue(false)

      await expect(
        deleteOwnBlueskyPost(database, actor, ownStatusId)
      ).rejects.toMatchObject({
        status: 422,
        message: BLUESKY_NOT_ALLOWED_MESSAGE
      })
      expect(post).not.toHaveBeenCalled()
    })
  })

  describe('replyToBlueskyPost idempotency', () => {
    it('records a completed idempotency key after createRecord and replays without reposting', async () => {
      post.mockResolvedValue({ uri: REPLY_URI, cid: REPLY_CID })
      vi.mocked(getPublicPosts)
        .mockResolvedValueOnce([
          makePostView({
            uri: PARENT_URI,
            cid: APPVIEW_PARENT_CID,
            did: PARENT_DID,
            handle: 'parent.bsky.social',
            text: 'Parent'
          })
        ])
        .mockResolvedValueOnce([
          makePostView({
            uri: REPLY_URI,
            cid: REPLY_CID,
            did: OWN_DID,
            handle: 'me.bsky.social',
            text: 'Idempotent reply',
            reply: {
              root: { uri: PARENT_URI, cid: APPVIEW_PARENT_CID },
              parent: { uri: PARENT_URI, cid: APPVIEW_PARENT_CID }
            }
          })
        ])

      const idempotency = {
        key: 'service-reply-key-1',
        contentHash: 'hash-reply-1'
      }
      const first = await replyToBlueskyPost(
        database,
        actor,
        {
          parentStatusId,
          text: 'Idempotent reply',
          idempotency
        },
        { wait: noWait }
      )
      const expectedStatusId = blueskyPostId(OWN_DID, REPLY_RKEY)
      expect(first).toEqual({ stored: true, statusId: expectedStatusId })
      expect(post).toHaveBeenCalledTimes(1)

      await expect(
        database.getIdempotencyKey({ actorId: actor.id, key: idempotency.key })
      ).resolves.toMatchObject({
        statusId: expectedStatusId,
        contentHash: idempotency.contentHash,
        state: 'complete'
      })

      // A replay with the same key and content returns the stored reply without posting again.
      const second = await replyToBlueskyPost(
        database,
        actor,
        {
          parentStatusId,
          text: 'Idempotent reply',
          idempotency
        },
        { wait: noWait }
      )
      expect(second).toEqual({ stored: true, statusId: expectedStatusId })
      expect(post).toHaveBeenCalledTimes(1)

      // A replay with the same key and different contentHash throws IdempotencyConflictError.
      await expect(
        replyToBlueskyPost(
          database,
          actor,
          {
            parentStatusId,
            text: 'Different reply',
            idempotency: {
              key: idempotency.key,
              contentHash: 'hash-different'
            }
          },
          { wait: noWait }
        )
      ).rejects.toBeInstanceOf(IdempotencyConflictError)
      expect(post).toHaveBeenCalledTimes(1)
    })

    it('records the deterministic statusId even when AppView readback lags and deduplicates concurrent retries', async () => {
      let releaseCreate!: (value: { uri: string; cid: string }) => void
      const createPromise = new Promise<{ uri: string; cid: string }>(
        (resolve) => {
          releaseCreate = resolve
        }
      )
      post.mockImplementationOnce(() => createPromise)
      // Parent lookup succeeds, AppView readback returns empty (not indexed yet).
      vi.mocked(getPublicPosts)
        .mockResolvedValueOnce([
          makePostView({
            uri: PARENT_URI,
            cid: APPVIEW_PARENT_CID,
            did: PARENT_DID,
            handle: 'parent.bsky.social',
            text: 'Parent'
          })
        ])
        .mockResolvedValue([])

      const idempotency = {
        key: 'service-concurrent-key',
        contentHash: 'hash-concurrent'
      }
      const req1 = replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: 'Concurrent reply', idempotency },
        { wait: noWait }
      )
      const req2 = replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: 'Concurrent reply', idempotency },
        { wait: noWait }
      )

      // Release createRecord once req1 has called it.
      await vi.waitFor(() => {
        expect(post).toHaveBeenCalledTimes(1)
      })
      releaseCreate({ uri: REPLY_URI, cid: REPLY_CID })

      const [res1, res2] = await Promise.all([req1, req2])
      expect(res1).toEqual({ stored: false })
      expect(res2).toEqual({ stored: false })
      expect(post).toHaveBeenCalledTimes(1)

      const expectedStatusId = blueskyPostId(OWN_DID, REPLY_RKEY)
      await expect(
        database.getIdempotencyKey({ actorId: actor.id, key: idempotency.key })
      ).resolves.toMatchObject({
        statusId: expectedStatusId,
        contentHash: idempotency.contentHash,
        state: 'complete'
      })
    })
  })
})
