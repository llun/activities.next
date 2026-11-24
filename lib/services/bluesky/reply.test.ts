import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { BlueskyActionError } from '@/lib/services/bluesky/actionErrors'
import {
  type BlueskyAgent,
  BlueskyRequestError,
  BlueskySessionChangedError,
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
const PARENT_CID = 'bafyparent'

const ROOT_URI = `at://${ROOT_DID}/app.bsky.feed.post/3kroot`
const ROOT_CID = 'bafyroot'

const REPLY_RKEY = '3kreply1'
const REPLY_URI = `at://${OWN_DID}/app.bsky.feed.post/${REPLY_RKEY}`
const REPLY_CID = 'bafyreply1'

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

    it('counts graphemes so 300 ZWJ emoji are accepted', async () => {
      const emojiText = '👨‍👩‍👧‍👦'.repeat(300)
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

      const statusId = await replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: emojiText },
        { wait: noWait }
      )
      expect(statusId).toBe(blueskyPostId(OWN_DID, REPLY_RKEY))
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

      const statusId = await replyToBlueskyPost(
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

      expect(statusId).toBe(blueskyPostId(OWN_DID, REPLY_RKEY))
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

    it('retries AppView readback 3 times then falls back to AppView author profile', async () => {
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
      vi.mocked(getPublicProfiles).mockResolvedValue([
        { did: OWN_DID, handle: 'me.bsky.social', displayName: 'Me' }
      ])
      post.mockResolvedValue({ uri: REPLY_URI, cid: REPLY_CID })

      const statusId = await replyToBlueskyPost(
        database,
        actor,
        { parentStatusId, text: 'Lagging reply' },
        { wait: noWait }
      )

      // 1 parent lookup + 4 readback attempts = 5 calls; 3 waits between retries.
      expect(getPublicPosts).toHaveBeenCalledTimes(5)
      expect(noWait).toHaveBeenCalledTimes(3)
      expect(getPublicProfiles).toHaveBeenCalledWith([OWN_DID])
      expect(statusId).toBe(blueskyPostId(OWN_DID, REPLY_RKEY))

      const stored = await database.getStatus({ statusId })
      expect(stored?.actorId).toBe(blueskyActorId(OWN_DID))
      expect(stored?.network).toBe('bluesky')
    })

    it('refuses to store if the actor relinked to another DID mid-request', async () => {
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

      await expect(
        replyToBlueskyPost(
          database,
          actor,
          { parentStatusId, text: 'Relink race' },
          { wait: noWait }
        )
      ).rejects.toBeInstanceOf(BlueskySessionChangedError)

      expect(
        await database.getStatus({
          statusId: blueskyPostId(OWN_DID, REPLY_RKEY)
        })
      ).toBeNull()
    })

    it('rejects an unexpected createRecord URI from another repo', async () => {
      vi.mocked(getPublicPosts).mockResolvedValueOnce([
        makePostView({
          uri: PARENT_URI,
          cid: PARENT_CID,
          did: PARENT_DID,
          handle: 'parent.bsky.social',
          text: 'Parent'
        })
      ])
      post.mockResolvedValue({
        uri: `at://${PARENT_DID}/app.bsky.feed.post/hijack`,
        cid: 'bafyhijack'
      })

      await expect(
        replyToBlueskyPost(
          database,
          actor,
          { parentStatusId, text: 'Hello' },
          { wait: noWait }
        )
      ).rejects.toThrow('Bluesky createRecord gave an unexpected answer')
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
})
