import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { getQueue } from '@/lib/services/queue'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

import { POST as bookmarkStatus } from './bookmark/route'
import { GET as getStatusContext } from './context/route'
import { POST as favouriteStatus } from './favourite/route'
import { GET as getStatusFavouritedBy } from './favourited_by/route'
import { GET as getStatusHistory } from './history/route'
import { POST as muteStatus } from './mute/route'
import { POST as pinStatus } from './pin/route'
import { POST as reblogStatus } from './reblog/route'
import { GET as getStatusRebloggedBy } from './reblogged_by/route'
import { GET, PUT } from './route'
import { GET as getStatusSource } from './source/route'
import { POST as unbookmarkStatus } from './unbookmark/route'
import { POST as unfavouriteStatus } from './unfavourite/route'
import { POST as unmuteStatus } from './unmute/route'
import { POST as unpinStatus } from './unpin/route'
import { POST as unreblogStatus } from './unreblog/route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

jest.mock('@/lib/services/queue', () => ({
  getQueue: jest.fn().mockReturnValue({
    publish: jest.fn().mockResolvedValue(undefined)
  })
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

type StatusRouteHandler = (
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response> | Response

const inaccessibleStatusRouteCases: Array<
  [string, 'GET' | 'POST', StatusRouteHandler]
> = [
  ['source', 'GET', getStatusSource],
  ['bookmark', 'POST', bookmarkStatus],
  ['unbookmark', 'POST', unbookmarkStatus],
  ['mute', 'POST', muteStatus],
  ['unmute', 'POST', unmuteStatus],
  ['favourite', 'POST', favouriteStatus],
  ['unfavourite', 'POST', unfavouriteStatus],
  ['reblog', 'POST', reblogStatus],
  ['unreblog', 'POST', unreblogStatus],
  ['pin', 'POST', pinStatus],
  ['unpin', 'POST', unpinStatus],
  ['favourited_by', 'GET', getStatusFavouritedBy],
  ['reblogged_by', 'GET', getStatusRebloggedBy]
]

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
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  describe('status retrieval and format', () => {
    it('allows anonymous reads for public statuses', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/post-1`
      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toMatchObject({
        id: urlToId(statusId),
        uri: statusId,
        visibility: 'public'
      })
    })

    it('returns not found for anonymous reads of followers-only statuses', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-private-anonymous-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Private anonymous read target',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(404)
    })

    it('allows the status owner to read followers-only statuses', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-private-owner-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Private owner read target',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.visibility).toBe('private')
    })

    it('allows accepted followers to read followers-only statuses', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      await database.createFollow({
        actorId: ACTOR2_ID,
        targetActorId: ACTOR1_ID,
        inbox: `${ACTOR1_ID}/inbox`,
        sharedInbox: `https://${TEST_DOMAIN}/inbox`,
        status: FollowStatus.enum.Accepted
      })

      const statusId = `${ACTOR1_ID}/statuses/api-private-follower-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Private follower read target',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.visibility).toBe('private')
    })

    it('returns not found for authenticated non-followers reading followers-only statuses by id', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-private-non-follower-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Private non-follower read target',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(404)
    })

    it('returns not found for authenticated non-recipients of direct statuses', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-direct-non-recipient-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Direct non-recipient read target',
        to: ['https://llun.test/users/third-user'],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(404)
    })

    it('allows direct recipients to read direct statuses', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-direct-recipient-read`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Direct recipient read target',
        to: [ACTOR2_ID],
        cc: []
      })

      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.visibility).toBe('direct')
    })

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

  describe('status-adjacent visibility checks', () => {
    it('returns not found for context of a followers-only status when requested by a non-follower', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-private-context-non-follower`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Private context target',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await getStatusContext(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/context`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(404)
    })

    it('returns not found for history of a followers-only status when requested by a non-follower', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-private-history-non-follower`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Private history target',
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await getStatusHistory(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/history`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(404)
    })

    it.each(inaccessibleStatusRouteCases)(
      'returns not found for %s of a followers-only status when requested by a non-follower',
      async (routeName, method, handler) => {
        mockGetServerSession.mockResolvedValue({
          user: { email: seedActor3.email }
        })

        const statusId = `${ACTOR1_ID}/statuses/api-private-${routeName}-non-follower`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: ACTOR1_ID,
          text: `Private ${routeName} target`,
          to: [`${ACTOR1_ID}/followers`],
          cc: []
        })

        const response = await handler(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(statusId)}/${routeName}`,
            { method }
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )

        expect(response.status).toBe(404)
      }
    )
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

  describe('status update', () => {
    it('applies visibility updates when spoiler_text is also present', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-visibility-with-cw`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public edit target',
        summary: 'Existing warning',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              visibility: 'private',
              spoiler_text: ''
            }),
            headers: {
              'Content-Type': 'application/json'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      const updatedStatus = await database.getStatus({ statusId })

      expect(data.visibility).toBe('private')
      expect(data.spoiler_text).toBe('')
      expect(updatedStatus?.summary).toBeNull()
      expect(updatedStatus?.to).toEqual([`${ACTOR1_ID}/followers`])
      expect(updatedStatus?.cc).toEqual([])
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
    })

    it('clears content warning when spoiler_text is null', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-null-cw`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Content warning target',
        summary: 'Existing warning',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              spoiler_text: null
            }),
            headers: {
              'Content-Type': 'application/json'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      const updatedStatus = await database.getStatus({ statusId })

      expect(data.spoiler_text).toBe('')
      expect(updatedStatus?.summary).toBeNull()
    })

    it('does not partially apply visibility when content update is forbidden', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })
      const statusId = `${ACTOR1_ID}/statuses/api-edit-forbidden-combined`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public edit target',
        summary: 'Existing warning',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              visibility: 'private',
              spoiler_text: ''
            }),
            headers: {
              'Content-Type': 'application/json'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      const updatedStatus = await database.getStatus({ statusId })

      expect(response.status).toBe(403)
      expect(updatedStatus?.summary).toBe('Existing warning')
      expect(updatedStatus?.to).toEqual([ACTIVITY_STREAM_PUBLIC])
      expect(updatedStatus?.cc).toEqual([`${ACTOR1_ID}/followers`])
      expect(getQueue().publish).not.toHaveBeenCalled()
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
