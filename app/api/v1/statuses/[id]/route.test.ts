import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Status, StatusType } from '@/lib/models/status'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

jest.mock('../../../../../lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({ host: 'llun.test' })
}))

/**
 * Tests for GET /api/v1/statuses/[id]
 *
 * This tests the underlying Mastodon status format returned by the API.
 * The actual API handler with authentication is tested separately.
 */
describe('GET /api/v1/statuses/[id]', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  describe('status retrieval and format', () => {
    it('returns status with correct Mastodon format', async () => {
      const statusId = `${ACTOR1_ID}/statuses/post-1`
      const status = (await database.getStatus({ statusId })) as Status
      const mastodonStatus = await getMastodonStatus(database, status)

      expect(mastodonStatus).not.toBeNull()
      expect(mastodonStatus).toMatchObject({
        id: urlToId(statusId),
        uri: statusId,
        url: expect.toBeString(),
        content: expect.toBeString(),
        visibility: 'public',
        sensitive: false,
        spoiler_text: '',
        created_at: expect.toBeString(),
        account: expect.objectContaining({
          id: urlToId(ACTOR1_ID),
          username: expect.toBeString(),
          acct: expect.toBeString(),
          url: ACTOR1_ID
        }),
        media_attachments: expect.toBeArray(),
        mentions: expect.toBeArray(),
        tags: expect.toBeArray(),
        emojis: expect.toBeArray(),
        replies_count: expect.toBeNumber(),
        reblogs_count: expect.toBeNumber(),
        favourites_count: expect.toBeNumber()
      })
    })

    it('returns 404-equivalent null when status does not exist', async () => {
      const status = await database.getStatus({
        statusId: 'https://example.com/non-existent-status'
      })

      expect(status).toBeNull()
    })

    it('returns null when actor is not found', async () => {
      const fakeStatus = {
        id: 'https://unknown.example.com/users/ghost/statuses/123',
        actorId: 'https://unknown.example.com/users/ghost',
        type: StatusType.enum.Note,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Ghost status',
        url: 'https://unknown.example.com/users/ghost/statuses/123',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        summary: null,
        reply: '',
        tags: [],
        attachments: [],
        replies: [],
        totalLikes: 0,
        isActorLiked: false,
        actorAnnounceStatusId: null,
        isLocalActor: false
      } as unknown as Status

      const mastodonStatus = await getMastodonStatus(database, fakeStatus)
      expect(mastodonStatus).toBeNull()
    })
  })

  describe('status visibility derivation', () => {
    it('returns public visibility for public posts', async () => {
      const publicStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/api-public-test`,
        url: `${ACTOR1_ID}/statuses/api-public-test`,
        actorId: ACTOR1_ID,
        text: 'Public API test',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const mastodonStatus = await getMastodonStatus(database, publicStatus)
      expect(mastodonStatus?.visibility).toBe('public')
    })

    it('returns unlist visibility for unlisted posts', async () => {
      const unlistStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/api-unlist-test`,
        url: `${ACTOR1_ID}/statuses/api-unlist-test`,
        actorId: ACTOR1_ID,
        text: 'Unlisted API test',
        to: [`${ACTOR1_ID}/followers`],
        cc: [ACTIVITY_STREAM_PUBLIC]
      })

      const mastodonStatus = await getMastodonStatus(database, unlistStatus)
      expect(mastodonStatus?.visibility).toBe('unlisted')
    })

    it('returns private visibility for followers-only posts', async () => {
      const privateStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/api-private-test`,
        url: `${ACTOR1_ID}/statuses/api-private-test`,
        actorId: ACTOR1_ID,
        text: 'Private API test',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const mastodonStatus = await getMastodonStatus(database, privateStatus)
      expect(mastodonStatus?.visibility).toBe('private')
    })

    it('returns direct visibility for direct messages', async () => {
      const directStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/api-direct-test`,
        url: `${ACTOR1_ID}/statuses/api-direct-test`,
        actorId: ACTOR1_ID,
        text: 'Direct API test',
        to: [ACTOR2_ID],
        cc: []
      })

      const mastodonStatus = await getMastodonStatus(database, directStatus)
      expect(mastodonStatus?.visibility).toBe('direct')
    })
  })

  describe('status with mentions', () => {
    it('includes mentions in the mentions array', async () => {
      const mentionStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/api-mention-test`,
        url: `${ACTOR1_ID}/statuses/api-mention-test`,
        actorId: ACTOR1_ID,
        text: '@test2@llun.test Check this out!',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [ACTOR2_ID]
      })

      await database.createTag({
        statusId: mentionStatus.id,
        type: 'mention',
        name: '@test2@llun.test',
        value: ACTOR2_ID
      })

      const statusWithTags = (await database.getStatus({
        statusId: mentionStatus.id,
        withReplies: false
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, statusWithTags)

      expect(mastodonStatus?.mentions).toHaveLength(1)
      expect(mastodonStatus?.mentions[0]).toMatchObject({
        id: urlToId(ACTOR2_ID),
        username: 'test2',
        acct: 'test2@llun.test',
        url: ACTOR2_ID
      })
    })
  })

  describe('status with emojis', () => {
    it('includes custom emojis in the emojis array', async () => {
      const emojiStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/api-emoji-test`,
        url: `${ACTOR1_ID}/statuses/api-emoji-test`,
        actorId: ACTOR1_ID,
        text: 'Love this :blobcat:',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createTag({
        statusId: emojiStatus.id,
        type: 'emoji',
        name: ':blobcat:',
        value: `https://${TEST_DOMAIN}/emojis/blobcat.png`
      })

      const statusWithTags = (await database.getStatus({
        statusId: emojiStatus.id,
        withReplies: false
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, statusWithTags)

      expect(mastodonStatus?.emojis).toHaveLength(1)
      expect(mastodonStatus?.emojis[0]).toMatchObject({
        shortcode: 'blobcat',
        url: `https://${TEST_DOMAIN}/emojis/blobcat.png`,
        static_url: `https://${TEST_DOMAIN}/emojis/blobcat.png`,
        visible_in_picker: true
      })
    })
  })

  describe('status with hashtags', () => {
    it('includes hashtags in the tags array', async () => {
      const hashtagStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/api-hashtag-test`,
        url: `${ACTOR1_ID}/statuses/api-hashtag-test`,
        actorId: ACTOR1_ID,
        text: 'Check out #fediverse content!',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createTag({
        statusId: hashtagStatus.id,
        type: 'hashtag',
        name: '#fediverse',
        value: `https://${TEST_DOMAIN}/tags/fediverse`
      })

      const statusWithTags = (await database.getStatus({
        statusId: hashtagStatus.id,
        withReplies: false
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, statusWithTags)

      expect(mastodonStatus?.tags).toHaveLength(1)
      expect(mastodonStatus?.tags[0]).toMatchObject({
        name: 'fediverse',
        url: `https://${TEST_DOMAIN}/tags/fediverse`
      })
    })
  })

  describe('status with spoiler text / content warning', () => {
    it('sets sensitive true and includes spoiler_text', async () => {
      const sensitiveStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/api-sensitive-test`,
        url: `${ACTOR1_ID}/statuses/api-sensitive-test`,
        actorId: ACTOR1_ID,
        text: 'Sensitive content here',
        summary: 'CW: Sensitive topic',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const mastodonStatus = await getMastodonStatus(database, sensitiveStatus)

      expect(mastodonStatus?.sensitive).toBe(true)
      expect(mastodonStatus?.spoiler_text).toBe('CW: Sensitive topic')
    })
  })

  describe('status with replies', () => {
    it('includes in_reply_to_id and in_reply_to_account_id', async () => {
      const status = (await database.getStatus({
        statusId: `${ACTOR2_ID}/statuses/reply-1`
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, status)

      expect(mastodonStatus?.in_reply_to_id).toBe(
        urlToId(`${ACTOR1_ID}/statuses/post-1`)
      )
      expect(mastodonStatus?.in_reply_to_account_id).toBe(urlToId(ACTOR1_ID))
    })
  })

  describe('reblog / announce status', () => {
    it('includes original status in reblog field', async () => {
      const status = (await database.getStatus({
        statusId: `${ACTOR2_ID}/statuses/post-3`
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, status)

      expect(mastodonStatus?.reblog).not.toBeNull()
      expect(mastodonStatus?.reblog?.id).toBe(
        urlToId(`${ACTOR2_ID}/statuses/post-2`)
      )
      expect(mastodonStatus?.content).toBe('')
    })
  })

  describe('reblogs count', () => {
    it('returns correct reblogs_count', async () => {
      // Create original status
      const originalStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/api-reblog-count-test`,
        url: `${ACTOR1_ID}/statuses/api-reblog-count-test`,
        actorId: ACTOR1_ID,
        text: 'This will be reblogged via API',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      // Create two reblogs
      await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/api-reblog-1`,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: originalStatus.id
      })

      await database.createAnnounce({
        id: `${ACTOR1_ID}/statuses/api-reblog-2`,
        actorId: ACTOR1_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: originalStatus.id
      })

      const status = (await database.getStatus({
        statusId: originalStatus.id
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, status)

      expect(mastodonStatus?.reblogs_count).toBe(2)
    })
  })

  describe('media attachments', () => {
    it('includes media attachments with correct format', async () => {
      const status = (await database.getStatus({
        statusId: `${ACTOR1_ID}/statuses/post-3`
      })) as Status

      const mastodonStatus = await getMastodonStatus(database, status)

      expect(mastodonStatus?.media_attachments).toHaveLength(2)
      expect(mastodonStatus?.media_attachments[0]).toMatchObject({
        id: expect.toBeString(),
        type: 'image',
        url: expect.toBeString(),
        preview_url: null,
        remote_url: null,
        description: expect.any(String),
        blurhash: null,
        meta: expect.objectContaining({
          original: expect.objectContaining({
            width: expect.toBeNumber(),
            height: expect.toBeNumber(),
            size: expect.toBeString(),
            aspect: expect.toBeNumber()
          })
        })
      })
    })
  })

  describe('text field', () => {
    it('includes plain text source', async () => {
      const textStatus = await database.createNote({
        id: `${ACTOR1_ID}/statuses/api-text-test`,
        url: `${ACTOR1_ID}/statuses/api-text-test`,
        actorId: ACTOR1_ID,
        text: 'Plain **text** with _formatting_',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const mastodonStatus = await getMastodonStatus(database, textStatus)

      expect(mastodonStatus?.text).toBe('Plain **text** with _formatting_')
    })
  })

  describe('idToUrl and urlToId encoding', () => {
    it('correctly encodes and decodes status IDs', () => {
      const originalUrl = `${ACTOR1_ID}/statuses/post-1`
      const encoded = urlToId(originalUrl)
      const decoded = idToUrl(encoded)

      expect(decoded).toBe(originalUrl)
    })
  })
})
