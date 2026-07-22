import knex from 'knex'
import { NextRequest } from 'next/server'

import { getSQLDatabase } from '@/lib/database/sql'
import { encodeFavouritedByCursor } from '@/lib/database/sql/utils/favouritedByCursor'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  MAX_FEDERATION_MEDIA_ATTACHMENTS,
  MAX_PINNED_STATUSES,
  MAX_STORED_MEDIA_ATTACHMENTS
} from '@/lib/services/mastodon/constants'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { deleteMediaFile } from '@/lib/services/medias'
import { getQueue } from '@/lib/services/queue'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID, seedActor3 } from '@/lib/stub/seed/actor3'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'
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
import { DELETE, GET, PUT } from './route'
import { GET as getStatusSource } from './source/route'
import { POST as unbookmarkStatus } from './unbookmark/route'
import { POST as unfavouriteStatus } from './unfavourite/route'
import { POST as unmuteStatus } from './unmute/route'
import { POST as unpinStatus } from './unpin/route'
import { POST as unreblogStatus } from './unreblog/route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', async () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', async () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/activities', async () => ({
  sendLike: vi.fn().mockResolvedValue(undefined),
  sendUndoLike: vi.fn().mockResolvedValue(undefined),
  deleteStatus: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/medias', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/medias')>()),
  deleteMediaFile: vi.fn().mockResolvedValue(true)
}))

vi.mock('@/lib/config', async () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
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
    vi.clearAllMocks()
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
            {
              method,
              ...(method === 'POST'
                ? { headers: { Origin: 'https://llun.test' } }
                : {})
            }
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )

        expect(response.status).toBe(404)
      }
    )

    it('allows actors to unreblog their announce when the original status is no longer readable', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })

      const originalStatusId = `${ACTOR1_ID}/statuses/api-unreblog-after-access-change`
      const announceId = `${ACTOR3_ID}/statuses/api-unreblog-after-access-change`
      await database.createNote({
        id: originalStatusId,
        url: originalStatusId,
        actorId: ACTOR1_ID,
        text: 'Original status that becomes private after a reblog',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createAnnounce({
        id: announceId,
        actorId: ACTOR3_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId
      })
      await database.updateNoteVisibility({
        statusId: originalStatusId,
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await unreblogStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(originalStatusId)}/unreblog`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(originalStatusId) }) }
      )

      expect(response.status).toBe(200)
      await expect(
        database.getStatus({ statusId: announceId })
      ).resolves.toBeNull()
    })

    it('allows actors to unfavourite their like when the original status is no longer readable', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-unfavourite-after-access-change`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Original status that becomes private after a favourite',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createLike({ actorId: ACTOR3_ID, statusId })
      await database.updateNoteVisibility({
        statusId,
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await unfavouriteStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/unfavourite`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      await expect(
        database.isActorLikedStatus({ actorId: ACTOR3_ID, statusId })
      ).resolves.toBe(false)
    })

    it('reblogs with a private visibility from a JSON body and scopes the boost to followers', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-reblog-visibility-json`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Reblog visibility JSON target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await reblogStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblog`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ visibility: 'private' })
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const announce = await database.getActorAnnounceStatus({
        actorId: ACTOR2_ID,
        statusId
      })
      expect(announce).not.toBeNull()
      expect(announce?.to).toEqual([`${ACTOR2_ID}/followers`])
      expect(announce?.cc).toEqual([ACTOR2_ID])
    })

    it('reblogs with an unlisted visibility from a urlencoded body', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-reblog-visibility-urlencoded`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Reblog visibility urlencoded target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await reblogStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblog`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'visibility=unlisted'
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const announce = await database.getActorAnnounceStatus({
        actorId: ACTOR2_ID,
        statusId
      })
      expect(announce).not.toBeNull()
      expect(announce?.to).toEqual([`${ACTOR2_ID}/followers`])
      expect(announce?.cc).toEqual([ACTIVITY_STREAM_PUBLIC, ACTOR2_ID])
    })

    it('defaults to a public boost when no visibility is sent', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-reblog-visibility-default`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Reblog visibility default target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await reblogStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblog`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const announce = await database.getActorAnnounceStatus({
        actorId: ACTOR2_ID,
        statusId
      })
      expect(announce).not.toBeNull()
      expect(announce?.to).toEqual([ACTIVITY_STREAM_PUBLIC])
      expect(announce?.cc).toEqual([ACTOR2_ID, `${ACTOR2_ID}/followers`])
    })

    it('rejects an invalid reblog visibility with 422', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-reblog-visibility-invalid`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Reblog visibility invalid target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await reblogStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblog`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ visibility: 'nonsense' })
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(422)
      await expect(
        database.getActorAnnounceStatus({ actorId: ACTOR2_ID, statusId })
      ).resolves.toBeNull()
    })

    it('rejects a malformed JSON reblog body with 422 (not 500)', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-reblog-malformed-json`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Reblog malformed json target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await reblogStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblog`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            },
            body: '{ broken json'
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(422)
      await expect(
        database.getActorAnnounceStatus({ actorId: ACTOR2_ID, statusId })
      ).resolves.toBeNull()
    })

    it('treats an empty JSON reblog body as a default public boost', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-reblog-empty-json`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Reblog empty json target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await reblogStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblog`,
          {
            method: 'POST',
            headers: {
              Origin: 'https://llun.test',
              'Content-Type': 'application/json'
            }
            // No body.
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const announce = await database.getActorAnnounceStatus({
        actorId: ACTOR2_ID,
        statusId
      })
      expect(announce?.to).toEqual([ACTIVITY_STREAM_PUBLIC])
    })

    it('bookmarks a readable status and returns bookmarked=true', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-bookmark-readable`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Readable bookmark target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await bookmarkStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/bookmark`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      await expect(
        database.isActorBookmarkedStatus({ actorId: ACTOR2_ID, statusId })
      ).resolves.toBe(true)
      await expect(response.json()).resolves.toMatchObject({
        id: urlToId(statusId),
        bookmarked: true
      })
    })

    it('does not duplicate bookmarks for repeated bookmark calls', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-bookmark-idempotent`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Idempotent bookmark target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      for (let i = 0; i < 2; i++) {
        const response = await bookmarkStatus(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(statusId)}/bookmark`,
            {
              method: 'POST',
              headers: { Origin: 'https://llun.test' }
            }
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )
        expect(response.status).toBe(200)
      }

      const bookmarks = await database.getBookmarks({
        actorId: ACTOR2_ID,
        limit: 20
      })
      expect(
        bookmarks.filter((bookmark) => bookmark.statusId === statusId)
      ).toHaveLength(1)
    })

    it('unbookmarks a readable status and returns bookmarked=false', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-unbookmark-readable`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Readable unbookmark target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createBookmark({ actorId: ACTOR2_ID, statusId })

      const response = await unbookmarkStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/unbookmark`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      await expect(
        database.isActorBookmarkedStatus({ actorId: ACTOR2_ID, statusId })
      ).resolves.toBe(false)
      await expect(response.json()).resolves.toMatchObject({
        id: urlToId(statusId),
        bookmarked: false
      })
    })

    it('pins an owned readable status and returns pinned=true', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-pin-owned-readable`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Owned pin target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await pinStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/pin`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      await expect(
        database.getPinnedStatusIds({
          actorId: ACTOR1_ID,
          statusIds: [statusId]
        })
      ).resolves.toEqual([statusId])
      await expect(response.json()).resolves.toMatchObject({
        id: urlToId(statusId),
        pinned: true
      })

      const getResponse = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'GET',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(getResponse.status).toBe(200)
      await expect(getResponse.json()).resolves.toMatchObject({
        id: urlToId(statusId),
        pinned: true
      })
    })

    it('returns 403 when a non-owner tries to pin a status', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-pin-non-owner`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Non-owner pin target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await pinStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/pin`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(403)
    })

    it('pins idempotently and unpins a non-pinned status with pinned=false', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-pin-idempotent`
      const neverPinnedStatusId = `${ACTOR1_ID}/statuses/api-unpin-never-pinned`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Idempotent pin target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: neverPinnedStatusId,
        url: neverPinnedStatusId,
        actorId: ACTOR1_ID,
        text: 'Never pinned unpin target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      for (let i = 0; i < 2; i++) {
        const response = await pinStatus(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(statusId)}/pin`,
            {
              method: 'POST',
              headers: { Origin: 'https://llun.test' }
            }
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )
        expect(response.status).toBe(200)
      }

      await expect(
        database.getPinnedStatusIds({
          actorId: ACTOR1_ID,
          statusIds: [statusId]
        })
      ).resolves.toEqual([statusId])

      const response = await unpinStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(neverPinnedStatusId)}/unpin`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(neverPinnedStatusId) }) }
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        id: urlToId(neverPinnedStatusId),
        pinned: false
      })
    })

    it('rejects attempts to pin reblogs', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const originalStatusId = `${ACTOR2_ID}/statuses/api-pin-reblog-original`
      const announceStatusId = `${ACTOR1_ID}/statuses/api-pin-reblog`
      await database.createNote({
        id: originalStatusId,
        url: originalStatusId,
        actorId: ACTOR2_ID,
        text: 'Original status for pin reblog rejection',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createAnnounce({
        id: announceStatusId,
        actorId: ACTOR1_ID,
        originalStatusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await pinStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(announceStatusId)}/pin`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(announceStatusId) }) }
      )

      expect(response.status).toBe(422)
      await expect(
        database.getPinnedStatusIds({
          actorId: ACTOR1_ID,
          statusIds: [announceStatusId]
        })
      ).resolves.toEqual([])
    })

    it('rejects attempts to pin direct-only statuses', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-pin-direct`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Direct pin target',
        to: [ACTOR2_ID],
        cc: []
      })

      const response = await pinStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/pin`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(422)
      await expect(
        database.getPinnedStatusIds({
          actorId: ACTOR1_ID,
          statusIds: [statusId]
        })
      ).resolves.toEqual([])
    })

    it('enforces the pinned status quota while keeping existing pins idempotent', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })

      const existingPins = await database.getPinnedStatusIds({
        actorId: ACTOR3_ID
      })
      for (const statusId of existingPins) {
        await database.unpinStatus({ actorId: ACTOR3_ID, statusId })
      }

      const suffix = `api-pin-quota-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const pinnedStatusIds = Array.from(
        { length: MAX_PINNED_STATUSES },
        (_, index) => `${ACTOR3_ID}/statuses/${suffix}-pinned-${index}`
      )
      for (const statusId of pinnedStatusIds) {
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: ACTOR3_ID,
          text: `Pinned quota target ${statusId}`,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        await database.pinStatus({ actorId: ACTOR3_ID, statusId })
      }

      const overflowStatusId = `${ACTOR3_ID}/statuses/${suffix}-overflow`
      await database.createNote({
        id: overflowStatusId,
        url: overflowStatusId,
        actorId: ACTOR3_ID,
        text: 'Overflow pin target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const overflowResponse = await pinStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(overflowStatusId)}/pin`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(overflowStatusId) }) }
      )

      expect(overflowResponse.status).toBe(422)
      await expect(
        database.getPinnedStatusIds({
          actorId: ACTOR3_ID,
          statusIds: [overflowStatusId]
        })
      ).resolves.toEqual([])

      const existingPinResponse = await pinStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pinnedStatusIds[0])}/pin`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pinnedStatusIds[0]) }) }
      )

      expect(existingPinResponse.status).toBe(200)
      await expect(existingPinResponse.json()).resolves.toMatchObject({
        id: urlToId(pinnedStatusIds[0]),
        pinned: true
      })
    })

    it('returns 500 when a readable unbookmark target cannot be reloaded after deletion', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-unbookmark-reload-missing`
      const status = await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Readable unbookmark target that disappears before reload',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createBookmark({ actorId: ACTOR2_ID, statusId })

      const getStatusSpy = vi.spyOn(database, 'getStatus')
      getStatusSpy.mockResolvedValueOnce(status)
      getStatusSpy.mockResolvedValueOnce(null)

      try {
        const response = await unbookmarkStatus(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(statusId)}/unbookmark`,
            {
              method: 'POST',
              headers: { Origin: 'https://llun.test' }
            }
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )

        expect(response.status).toBe(500)
      } finally {
        getStatusSpy.mockRestore()
      }

      await expect(
        database.isActorBookmarkedStatus({ actorId: ACTOR2_ID, statusId })
      ).resolves.toBe(false)
    })

    it('deletes the bookmark and returns the Status with bookmarked=false when the original status is no longer readable', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-unbookmark-after-access-change`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Original status that becomes private after a bookmark',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createBookmark({ actorId: ACTOR3_ID, statusId })
      await database.updateNoteVisibility({
        statusId,
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })

      const response = await unbookmarkStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/unbookmark`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      // Mastodon returns the Status (not a 404) so the client can reconcile its
      // local bookmark state, even though the post is no longer visible.
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        id: urlToId(statusId),
        bookmarked: false
      })
      await expect(
        database.isActorBookmarkedStatus({ actorId: ACTOR3_ID, statusId })
      ).resolves.toBe(false)
    })

    it('cleans up a boost bookmark and returns 404 when the boost is gone and original is unreadable', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-unbookmark-deleted-boost-original`
      const announceId = `${ACTOR2_ID}/statuses/api-unbookmark-deleted-boost`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Original status behind a deleted boost bookmark',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createAnnounce({
        id: announceId,
        actorId: ACTOR2_ID,
        originalStatusId: statusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createBookmark({
        actorId: ACTOR3_ID,
        statusId: announceId
      })
      await database.updateNoteVisibility({
        statusId,
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })
      await database.deleteStatus({ statusId: announceId })

      const response = await unbookmarkStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(announceId)}/unbookmark`,
          {
            method: 'POST',
            headers: { Origin: 'https://llun.test' }
          }
        ),
        { params: Promise.resolve({ id: urlToId(announceId) }) }
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'Not Found' })
      await expect(
        database.isActorBookmarkedStatus({ actorId: ACTOR3_ID, statusId })
      ).resolves.toBe(false)
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

  describe('status update', () => {
    it('replaces media attachments with a media-only edit and federates the update', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-replace-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Media edit target',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const oldMedia = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-old.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-old.jpg'
        },
        description: 'Old media'
      })
      const newMedia = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-new.webp',
          bytes: 2048,
          mimeType: 'image/png',
          metaData: { width: 640, height: 480 },
          fileName: 'api-edit-new.png'
        },
        description: 'New media'
      })
      expect(oldMedia).not.toBeNull()
      expect(newMedia).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: oldMedia!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-old.webp',
        width: 320,
        height: 240,
        name: 'Old media',
        mediaId: oldMedia!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_ids: [newMedia!.id]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.content).toContain('Media edit target')
      expect(data.media_attachments).toHaveLength(1)
      expect(data.media_attachments[0]).toMatchObject({
        type: 'image',
        url: 'https://llun.test/api/v1/files/medias/api-edit-new.webp',
        description: 'New media'
      })

      const attachments = await database.getAttachmentsWithMedia({ statusId })
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        mediaId: String(newMedia!.id),
        url: 'https://llun.test/api/v1/files/medias/api-edit-new.webp',
        name: 'New media'
      })

      const updatedStatus = (await database.getStatus({
        statusId,
        withReplies: false
      })) as Status
      const activityPubNote = getNoteFromStatus(updatedStatus)
      expect(activityPubNote?.attachment).toEqual([
        expect.objectContaining({
          mediaType: 'image/png',
          url: 'https://llun.test/api/v1/files/medias/api-edit-new.webp',
          name: 'New media'
        })
      ])
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
    })

    it('stores more media than the federation cap and federates only the first few', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-many-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Fitness ride with a full photo set',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const storedCount = MAX_FEDERATION_MEDIA_ATTACHMENTS + 1
      const mediaIds: string[] = []
      for (let index = 0; index < storedCount; index += 1) {
        const media = await database.createMedia({
          actorId: ACTOR1_ID,
          original: {
            path: `medias/api-edit-many-${index}.webp`,
            bytes: 1024,
            mimeType: 'image/jpeg',
            metaData: { width: 320, height: 240 },
            fileName: `api-edit-many-${index}.jpg`
          },
          description: `Ride photo ${index}`
        })
        expect(media).not.toBeNull()
        mediaIds.push(media!.id)
      }

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ media_ids: mediaIds }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      // The local Mastodon API returns every stored attachment...
      const data = await response.json()
      expect(data.media_attachments).toHaveLength(storedCount)

      const attachments = await database.getAttachmentsWithMedia({ statusId })
      expect(attachments).toHaveLength(storedCount)

      // ...while the outbound ActivityPub note is trimmed to the federation cap.
      const updatedStatus = (await database.getStatus({
        statusId,
        withReplies: false
      })) as Status
      const activityPubNote = getNoteFromStatus(updatedStatus)
      const federatedAttachments = Array.isArray(activityPubNote?.attachment)
        ? activityPubNote.attachment
        : []
      expect(federatedAttachments).toHaveLength(
        MAX_FEDERATION_MEDIA_ATTACHMENTS
      )
    })

    it('attaches a full photo set to a fitness ride and keeps the route map', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-fitness-photos`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Morning ride',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })
      // The route map is a media-manager image upload, mirroring the fitness
      // import job (processFitnessFileJob stores it via saveMedia).
      const mapMedia = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/ride-route-map.webp',
          bytes: 2048,
          mimeType: 'image/png',
          metaData: { width: 640, height: 480 },
          fileName: 'ride-route-map.png'
        },
        description: 'Activity route map'
      })
      expect(mapMedia).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/png',
        url: 'https://llun.test/api/v1/files/medias/ride-route-map.webp',
        width: 640,
        height: 480,
        name: 'Activity route map',
        mediaId: mapMedia!.id
      })

      const photoCount = MAX_FEDERATION_MEDIA_ATTACHMENTS
      const photoMediaIds: string[] = []
      for (let index = 0; index < photoCount; index += 1) {
        const media = await database.createMedia({
          actorId: ACTOR1_ID,
          original: {
            path: `medias/ride-photo-${index}.webp`,
            bytes: 1024,
            mimeType: 'image/jpeg',
            metaData: { width: 320, height: 240 },
            fileName: `ride-photo-${index}.jpg`
          },
          description: `Ride photo ${index}`
        })
        expect(media).not.toBeNull()
        photoMediaIds.push(media!.id)
      }

      // A correct client re-sends the existing map alongside the new photos, so
      // the edited set (map + photos) is larger than the federation cap.
      const mediaIds = [mapMedia!.id, ...photoMediaIds]

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ media_ids: mediaIds }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)

      // Every photo plus the route map remain on the status.
      const updatedStatus = (await database.getStatus({
        statusId,
        withReplies: false
      })) as Status
      expect(updatedStatus.attachments).toHaveLength(mediaIds.length)
      expect(
        updatedStatus.attachments.some(
          (attachment) => attachment.name === 'Activity route map'
        )
      ).toBe(true)

      // The federated note is still trimmed to the Mastodon cap.
      const activityPubNote = getNoteFromStatus(updatedStatus)
      const federatedAttachments = Array.isArray(activityPubNote?.attachment)
        ? activityPubNote.attachment
        : []
      expect(federatedAttachments).toHaveLength(
        MAX_FEDERATION_MEDIA_ATTACHMENTS
      )
    })

    it('rejects more media_ids than the stored ceiling with 422', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-over-ceiling`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Over the stored ceiling',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const mediaIds = Array.from(
        { length: MAX_STORED_MEDIA_ATTACHMENTS + 1 },
        (_, index) => `over-ceiling-media-${index}`
      )

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ media_ids: mediaIds }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(422)
    })

    it('rejects more media_attributes than the stored ceiling with 422', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-attributes-over-ceiling`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Over the stored ceiling with attributes',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      // Every attribute references an owned, resolvable media, so without the
      // ceiling each one would trigger a database.updateMedia write — the
      // unbounded fan-out this guards against.
      const mediaAttributes = []
      for (
        let index = 0;
        index < MAX_STORED_MEDIA_ATTACHMENTS + 1;
        index += 1
      ) {
        const media = await database.createMedia({
          actorId: ACTOR1_ID,
          original: {
            path: `medias/attr-ceiling-${index}.webp`,
            bytes: 1024,
            mimeType: 'image/jpeg',
            metaData: { width: 100, height: 100 },
            fileName: `attr-ceiling-${index}.jpg`
          }
        })
        expect(media).not.toBeNull()
        mediaAttributes.push({ id: media!.id, description: `Photo ${index}` })
      }

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ media_attributes: mediaAttributes }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(422)
    })

    it('clears media attachments with an empty media id list', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-clear-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Clear media target',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-clear.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-clear.jpg'
        },
        description: 'Clear media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-clear.webp',
        width: 320,
        height: 240,
        name: 'Clear media',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_ids: []
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.media_attachments).toEqual([])
      await expect(database.getAttachments({ statusId })).resolves.toEqual([])
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
    })

    it('allows clearing editable media from a blank note when legacy attachments remain', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-clear-media-keep-legacy`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: '',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-clear-legacy-editable.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-clear-legacy-editable.jpg'
        },
        description: 'Editable media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-clear-legacy-editable.webp',
        width: 320,
        height: 240,
        name: 'Editable media',
        mediaId: media!.id
      })
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/jpeg',
        url: 'https://remote.example/legacy.jpg',
        width: 640,
        height: 480,
        name: 'Legacy media'
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              status: '   ',
              media_ids: []
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.media_attachments).toHaveLength(1)
      expect(data.media_attachments[0]).toMatchObject({
        type: 'image',
        url: 'https://remote.example/legacy.jpg',
        description: 'Legacy media'
      })

      const attachments = await database.getAttachments({ statusId })
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        mediaId: null,
        url: 'https://remote.example/legacy.jpg',
        name: 'Legacy media'
      })
      expect(getQueue().publish).toHaveBeenCalledTimes(1)
    })

    it('rejects clearing media from a media-only note without partial mutation', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-reject-clear-media-only`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: '',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-reject-clear-media-only.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-reject-clear-media-only.jpg'
        },
        description: 'Only media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-reject-clear-media-only.webp',
        width: 320,
        height: 240,
        name: 'Only media',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_ids: []
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      const updatedStatus = await database.getStatus({ statusId })
      const attachments = await database.getAttachments({ statusId })

      expect(response.status).toBe(422)
      expect(updatedStatus?.text).toBe('')
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        url: 'https://llun.test/api/v1/files/medias/api-edit-reject-clear-media-only.webp',
        name: 'Only media'
      })
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('rejects blank status with empty media ids without partial mutation', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-reject-blank-clear-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Original text before rejected edit',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-reject-blank-clear-media.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-reject-blank-clear-media.jpg'
        },
        description: 'Preserved media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-reject-blank-clear-media.webp',
        width: 320,
        height: 240,
        name: 'Preserved media',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              status: '   ',
              media_ids: []
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      const updatedStatus = await database.getStatus({ statusId })
      const attachments = await database.getAttachments({ statusId })

      expect(response.status).toBe(422)
      expect(updatedStatus?.text).toBe('Original text before rejected edit')
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        url: 'https://llun.test/api/v1/files/medias/api-edit-reject-blank-clear-media.webp',
        name: 'Preserved media'
      })
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

    it('does not partially apply text changes when media ids are forbidden', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-forbidden-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Original media ownership text',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const foreignMedia = await database.createMedia({
        actorId: ACTOR2_ID,
        original: {
          path: 'medias/api-edit-foreign.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-foreign.jpg'
        },
        description: 'Foreign media'
      })
      expect(foreignMedia).not.toBeNull()

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              status: 'Should not be applied',
              media_ids: [foreignMedia!.id]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      const updatedStatus = await database.getStatus({ statusId })
      expect(response.status).toBe(422)
      expect(updatedStatus?.text).toBe('Original media ownership text')
      expect(getQueue().publish).not.toHaveBeenCalled()
    })

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
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
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

    it('edits text from a urlencoded body without wiping unmentioned media (native clients)', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-urlencoded-keep-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Original urlencoded text',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-urlencoded-keep.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-urlencoded-keep.jpg'
        },
        description: 'Kept media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-urlencoded-keep.webp',
        width: 320,
        height: 240,
        name: 'Kept media',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            // Only `status` is sent — `media_ids` is absent. The omit-if-absent
            // parser must leave it undefined so existing media is preserved
            // rather than coerced to an empty array and wiped.
            body: new URLSearchParams({
              status: 'Edited via urlencoded'
            }).toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.content).toContain('Edited via urlencoded')
      expect(data.media_attachments).toHaveLength(1)
      const attachments = await database.getAttachments({ statusId })
      expect(attachments).toHaveLength(1)
    })

    it('clears media from a urlencoded body with an explicit empty media_ids[]', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-urlencoded-clear-media`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Keeps text while clearing media',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-urlencoded-clear.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-urlencoded-clear.jpg'
        },
        description: 'Cleared media'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-urlencoded-clear.webp',
        width: 320,
        height: 240,
        name: 'Cleared media',
        mediaId: media!.id
      })

      // `media_ids[]=` (present but empty) must clear attachments, mirroring a
      // JSON `media_ids: []`, rather than being dropped as absent.
      const params = new URLSearchParams({
        status: 'Keeps text while clearing'
      })
      params.append('media_ids[]', '')

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: params.toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.media_attachments).toEqual([])
      await expect(database.getAttachments({ statusId })).resolves.toEqual([])
    })

    it('returns 400 for a malformed JSON edit body', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-malformed-json`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Malformed edit target',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            // Syntactically broken JSON must surface as 400 (bad request), not a
            // 422 from a swallowed empty body.
            body: '{ "status": "oops" ',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(400)
      const updatedStatus = await database.getStatus({ statusId })
      expect(updatedStatus?.text).toBe('Malformed edit target')
    })

    it('applies a visibility-only edit from a urlencoded body', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-urlencoded-visibility`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Visibility urlencoded target',
        summary: null,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${ACTOR1_ID}/followers`]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: new URLSearchParams({ visibility: 'private' }).toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Origin: 'https://llun.test'
            }
          }
        ),
        {
          params: Promise.resolve({ id: urlToId(statusId) })
        }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.visibility).toBe('private')
      // Text must survive a visibility-only edit (status omitted, not blanked).
      expect(data.content).toContain('Visibility urlencoded target')
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
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
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
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
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

    it('updates attachment description and focus through media_attributes', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-media-attributes`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Media attributes target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-attributes.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-attributes.jpg'
        },
        description: 'Old description'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-attributes.webp',
        width: 320,
        height: 240,
        name: 'Old description',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_attributes: [
                {
                  id: media!.id,
                  description: 'New description',
                  focus: '0.5,-0.5'
                }
              ]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.media_attachments).toHaveLength(1)
      expect(data.media_attachments[0]).toMatchObject({
        description: 'New description'
      })

      const actor = await database.getActorFromId({ id: ACTOR1_ID })
      const updatedMedia = await database.getMediaByIdForAccount({
        mediaId: media!.id,
        accountId: actor!.account!.id
      })
      expect(updatedMedia?.description).toBe('New description')
      expect(updatedMedia?.focus).toEqual({ x: 0.5, y: -0.5 })
    })

    it('keeps the existing description when media_attributes only updates focus', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-media-attributes-focus`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Focus only target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-attributes-focus.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-attributes-focus.jpg'
        },
        description: 'Keep description'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-attributes-focus.webp',
        width: 320,
        height: 240,
        name: 'Keep description',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_attributes: [{ id: media!.id, focus: '0,1' }]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const actor = await database.getActorFromId({ id: ACTOR1_ID })
      const updatedMedia = await database.getMediaByIdForAccount({
        mediaId: media!.id,
        accountId: actor!.account!.id
      })
      // An omitted description must be left untouched (not cleared to null).
      expect(updatedMedia?.description).toBe('Keep description')
      expect(updatedMedia?.focus).toEqual({ x: 0, y: 1 })
    })

    it('clears an attachment description when media_attributes sends description null', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-media-attributes-clear`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Clear description target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: 'medias/api-edit-attributes-clear.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-attributes-clear.jpg'
        },
        description: 'Alt text to clear'
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: 'https://llun.test/api/v1/files/medias/api-edit-attributes-clear.webp',
        width: 320,
        height: 240,
        name: 'Alt text to clear',
        mediaId: media!.id
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_attributes: [{ id: media!.id, description: null }]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const actor = await database.getActorFromId({ id: ACTOR1_ID })
      const updatedMedia = await database.getMediaByIdForAccount({
        mediaId: media!.id,
        accountId: actor!.account!.id
      })
      // Explicit null clears the stored alt text (blank/null normalise to null).
      expect(updatedMedia?.description ?? null).toBeNull()
    })

    it('rejects media_attributes for media the actor does not own', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-media-attributes-foreign`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Foreign media attributes target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const foreignMedia = await database.createMedia({
        actorId: ACTOR2_ID,
        original: {
          path: 'medias/api-edit-attributes-foreign.webp',
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: 'api-edit-attributes-foreign.jpg'
        }
      })
      expect(foreignMedia).not.toBeNull()

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              media_attributes: [
                { id: foreignMedia!.id, description: 'Hijacked' }
              ]
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(422)
    })

    it('edits poll options with vote reset and snapshots the old options in history', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-options`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Editable poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Old A', 'Old B'],
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR2_ID,
        choices: [0]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              status: 'Editable poll v2',
              poll: {
                options: ['New A', 'New B'],
                expires_in: 7200,
                hide_totals: true
              }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.content).toContain('Editable poll v2')
      // Replaced options start from zero and hide_totals nulls the running
      // tallies per option.
      expect(data.poll.options).toEqual([
        { title: 'New A', votes_count: null },
        { title: 'New B', votes_count: null }
      ])
      expect(data.poll.votes_count).toBe(0)
      expect(data.poll.voters_count).toBe(0)
      // expires_in (7200s) is rebased from now into expires_at (seconds -> ms).
      const expiresAt = new Date(data.poll.expires_at).getTime()
      expect(Math.abs(expiresAt - (Date.now() + 7200 * 1000))).toBeLessThan(
        60_000
      )

      const historyResponse = await getStatusHistory(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}/history`
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )
      const revisions = await historyResponse.json()
      expect(revisions).toHaveLength(2)
      expect(revisions[0].poll).toEqual({
        options: [{ title: 'Old A' }, { title: 'Old B' }]
      })
      expect(revisions[1].poll).toEqual({
        options: [{ title: 'New A' }, { title: 'New B' }]
      })
    })

    it('keeps existing votes when only hide_totals changes on a poll edit', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-hide-totals-only`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Hide totals only poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Yes', 'No'],
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR2_ID,
        choices: [0]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              poll: { options: ['Yes', 'No'], hide_totals: true }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      // Votes survive; hide_totals only masks the per-option numbers.
      expect(data.poll.votes_count).toBe(1)
      expect(data.poll.voters_count).toBe(1)
      expect(data.poll.options).toEqual([
        { title: 'Yes', votes_count: null },
        { title: 'No', votes_count: null }
      ])
    })

    it('resets votes and switches to anyOf when a poll edit flips multiple to true', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-multiple-flip`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Single choice poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Red', 'Blue'],
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR2_ID,
        choices: [0]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              poll: { options: ['Red', 'Blue'], multiple: true }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      // Same options, but flipping the multiple-choice mode resets votes and
      // switches the poll to anyOf (Mastodon UpdateStatusService#update_poll!).
      expect(data.poll.multiple).toBe(true)
      expect(data.poll.votes_count).toBe(0)
      expect(data.poll.voters_count).toBe(0)
    })

    it.each([
      {
        description: 'a poll payload on a note edit',
        body: { poll: { options: ['A', 'B'] } }
      }
    ])('rejects $description with 422', async ({ body }) => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-note-no-poll`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Note cannot gain a poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify(body),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(422)
    })

    it.each([
      { param: 'media_ids', body: { media_ids: ['1'] } },
      {
        param: 'media_attributes',
        body: { media_attributes: [{ id: '1', description: 'x' }] }
      },
      { param: 'visibility', body: { visibility: 'private' } }
    ])(
      'rejects a poll edit that also changes $param with 422',
      async ({ param, body }) => {
        const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-reject-${param}`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: ACTOR1_ID,
          text: 'Poll cannot change media or visibility',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          choices: ['Yes', 'No'],
          endAt: Date.now() + 60_000
        })

        const response = await PUT(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
            {
              method: 'PUT',
              body: JSON.stringify(body),
              headers: {
                'Content-Type': 'application/json',
                Origin: 'https://llun.test'
              }
            }
          ),
          { params: Promise.resolve({ id: urlToId(pollId) }) }
        )

        expect(response.status).toBe(422)
      }
    )

    it('allows a poll edit that carries an empty media_ids array', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-empty-media`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Poll with an empty media edit',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Yes', 'No'],
        endAt: Date.now() + 60_000
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              // Many clients send an empty media_ids by default; on a poll edit
              // that must be ignored, not rejected with 422.
              media_ids: [],
              poll: { options: ['Yes', 'No'], hide_totals: true }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
    })
  })

  describe('status delete', () => {
    const createNoteWithMedia = async (suffix: string) => {
      const statusId = `${ACTOR1_ID}/statuses/api-delete-${suffix}`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Delete target',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      const media = await database.createMedia({
        actorId: ACTOR1_ID,
        original: {
          path: `medias/api-delete-${suffix}.webp`,
          bytes: 1024,
          mimeType: 'image/jpeg',
          metaData: { width: 320, height: 240 },
          fileName: `api-delete-${suffix}.jpg`
        },
        thumbnail: {
          path: `medias/api-delete-${suffix}-thumb.webp`,
          bytes: 128,
          mimeType: 'image/webp',
          metaData: { width: 32, height: 24 }
        }
      })
      expect(media).not.toBeNull()
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: media!.original.mimeType,
        url: `https://llun.test/api/v1/files/medias/api-delete-${suffix}.webp`,
        width: 320,
        height: 240,
        name: 'Delete media',
        mediaId: media!.id
      })
      return { statusId, media: media! }
    }

    const deleteStatusRequest = (statusId: string, query = '') =>
      DELETE(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}${query}`,
          { method: 'DELETE', headers: { Origin: 'https://llun.test' } }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

    it('destroys media rows and storage files when delete_media is true', async () => {
      const { statusId, media } = await createNoteWithMedia('with-media')

      const response = await deleteStatusRequest(statusId, '?delete_media=true')

      expect(response.status).toBe(200)
      await expect(
        database.getStatus({ statusId, withReplies: false })
      ).resolves.toBeNull()

      const actor = await database.getActorFromId({ id: ACTOR1_ID })
      await expect(
        database.getMediaByIdForAccount({
          mediaId: media.id,
          accountId: actor!.account!.id
        })
      ).resolves.toBeNull()
      expect(deleteMediaFile).toHaveBeenCalledWith(
        expect.anything(),
        'medias/api-delete-with-media.webp'
      )
      expect(deleteMediaFile).toHaveBeenCalledWith(
        expect.anything(),
        'medias/api-delete-with-media-thumb.webp'
      )
    })

    it.each([
      { description: 'omits delete_media', suffix: 'keep-default', query: '' },
      {
        description: 'sends delete_media=false',
        suffix: 'keep-false',
        query: '?delete_media=false'
      }
    ])(
      'keeps media rows for redrafting when the client $description',
      async ({ suffix, query }) => {
        const { statusId, media } = await createNoteWithMedia(suffix)

        const response = await deleteStatusRequest(statusId, query)

        expect(response.status).toBe(200)
        const actor = await database.getActorFromId({ id: ACTOR1_ID })
        await expect(
          database.getMediaByIdForAccount({
            mediaId: media.id,
            accountId: actor!.account!.id
          })
        ).resolves.not.toBeNull()
        expect(deleteMediaFile).not.toHaveBeenCalled()
      }
    )
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

  describe('reblogged_by', () => {
    it('returns boosting accounts with Mastodon pagination for a public status without auth', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-test`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public status with reblogs',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const olderAnnounceId = `${ACTOR2_ID}/statuses/api-reblogged-by-older`
      const newerAnnounceId = `${ACTOR3_ID}/statuses/api-reblogged-by-newer`
      await database.createAnnounce({
        id: olderAnnounceId,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-01-01T00:00:00.000Z')
      })
      await database.createAnnounce({
        id: newerAnnounceId,
        actorId: ACTOR3_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-01-02T00:00:00.000Z')
      })

      const firstResponse = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(
            statusId
          )}/reblogged_by?limit=1`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(firstResponse.status).toBe(200)
      const firstPage = (await firstResponse.json()) as { id: string }[]
      expect(firstPage.map((account) => account.id)).toEqual([
        urlToId(ACTOR3_ID)
      ])
      expect(firstResponse.headers.get('Link')).toEqual(
        expect.stringContaining(
          `max_id=${encodeURIComponent(urlToId(newerAnnounceId))}`
        )
      )

      const nextResponse = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(
            statusId
          )}/reblogged_by?limit=1&max_id=${urlToId(newerAnnounceId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(nextResponse.status).toBe(200)
      const nextPage = (await nextResponse.json()) as { id: string }[]
      expect(nextPage.map((account) => account.id)).toEqual([
        urlToId(ACTOR2_ID)
      ])
      const nextLinkHeader = nextResponse.headers.get('Link')
      expect(nextLinkHeader).not.toEqual(expect.stringContaining('rel="next"'))
      expect(nextLinkHeader).toEqual(
        expect.stringContaining(
          `since_id=${encodeURIComponent(urlToId(olderAnnounceId))}`
        )
      )
    })

    it('deduplicates boosting accounts before applying cursor pagination', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-duplicate-actors`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public status with duplicate actor reblogs',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const olderDuplicateAnnounceId = `${ACTOR2_ID}/statuses/api-reblogged-by-duplicate-older`
      const middleAnnounceId = `${ACTOR3_ID}/statuses/api-reblogged-by-duplicate-middle`
      const newerDuplicateAnnounceId = `${ACTOR2_ID}/statuses/api-reblogged-by-duplicate-newer`

      await database.createAnnounce({
        id: olderDuplicateAnnounceId,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-03-01T00:00:00.000Z')
      })
      await database.createAnnounce({
        id: middleAnnounceId,
        actorId: ACTOR3_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-03-02T00:00:00.000Z')
      })
      await database.createAnnounce({
        id: newerDuplicateAnnounceId,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-03-03T00:00:00.000Z')
      })

      const fullResponse = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblogged_by`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(fullResponse.status).toBe(200)
      const fullPage = (await fullResponse.json()) as { id: string }[]
      expect(fullPage.map((account) => account.id)).toEqual([
        urlToId(ACTOR2_ID),
        urlToId(ACTOR3_ID)
      ])

      const firstResponse = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(
            statusId
          )}/reblogged_by?limit=1`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(firstResponse.status).toBe(200)
      expect(firstResponse.headers.get('Link')).toEqual(
        expect.stringContaining(
          `max_id=${encodeURIComponent(urlToId(newerDuplicateAnnounceId))}`
        )
      )

      const nextResponse = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(
            statusId
          )}/reblogged_by?limit=1&max_id=${urlToId(newerDuplicateAnnounceId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(nextResponse.status).toBe(200)
      const nextPage = (await nextResponse.json()) as { id: string }[]
      expect(nextPage.map((account) => account.id)).toEqual([
        urlToId(ACTOR3_ID)
      ])
    })

    it('accepts a visible reblog cursor even after a newer duplicate supersedes it', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-superseded-cursor`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public status with superseded cursor reblogs',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const cursorAnnounceId = `${ACTOR2_ID}/statuses/api-reblogged-by-superseded-cursor`
      const olderAnnounceId = `${ACTOR3_ID}/statuses/api-reblogged-by-superseded-older`
      await database.createAnnounce({
        id: olderAnnounceId,
        actorId: ACTOR3_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-06-01T00:00:00.000Z')
      })
      await database.createAnnounce({
        id: cursorAnnounceId,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-06-02T00:00:00.000Z')
      })

      const firstResponse = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(
            statusId
          )}/reblogged_by?limit=1`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      expect(firstResponse.status).toBe(200)
      expect(firstResponse.headers.get('Link')).toEqual(
        expect.stringContaining(
          `max_id=${encodeURIComponent(urlToId(cursorAnnounceId))}`
        )
      )

      await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/api-reblogged-by-superseded-newer`,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-06-03T00:00:00.000Z')
      })

      const nextResponse = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(
            statusId
          )}/reblogged_by?limit=1&max_id=${urlToId(cursorAnnounceId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(nextResponse.status).toBe(200)
      const nextPage = (await nextResponse.json()) as { id: string }[]
      expect(nextPage.map((account) => account.id)).toEqual([
        urlToId(ACTOR3_ID)
      ])
    })

    it('accepts a since_id cursor even after a newer duplicate supersedes it', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-superseded-since`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public status with superseded since cursor reblogs',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const cursorAnnounceId = `${ACTOR2_ID}/statuses/api-reblogged-by-superseded-since`
      await database.createAnnounce({
        id: cursorAnnounceId,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-07-01T00:00:00.000Z')
      })

      await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/api-reblogged-by-superseded-since-newer`,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-07-02T00:00:00.000Z')
      })

      const response = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(
            statusId
          )}/reblogged_by?since_id=${urlToId(cursorAnnounceId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const accounts = (await response.json()) as { id: string }[]
      expect(accounts.map((account) => account.id)).toEqual([
        urlToId(ACTOR2_ID)
      ])
    })

    it('does not expose non-public boosts to anonymous clients', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-private-boost`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public status with a private boost',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/api-reblogged-by-public-boost`,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId
      })
      await database.createAnnounce({
        id: `${ACTOR3_ID}/statuses/api-reblogged-by-hidden-boost`,
        actorId: ACTOR3_ID,
        to: [`${ACTOR3_ID}/followers`],
        cc: [],
        originalStatusId: statusId
      })

      const response = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblogged_by`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const accounts = (await response.json()) as { id: string }[]
      expect(accounts.map((account) => account.id)).toEqual([
        urlToId(ACTOR2_ID)
      ])
    })

    it('includes public legacy boosts stored only in content for anonymous clients', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const knexDatabase = knex({
        client: 'better-sqlite3',
        useNullAsDefault: true,
        connection: {
          filename: ':memory:'
        }
      })
      const sqlDatabase = getSQLDatabase(knexDatabase)
      const previousDatabase = mockDatabase

      try {
        await sqlDatabase.migrate()
        await seedDatabase(sqlDatabase)
        mockDatabase = sqlDatabase

        const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-legacy-boost`
        await sqlDatabase.createNote({
          id: statusId,
          url: statusId,
          actorId: ACTOR1_ID,
          text: 'Public status with a legacy boost',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })

        const legacyAnnounceId = `${ACTOR2_ID}/statuses/api-reblogged-by-legacy-boost`
        const createdAt = new Date('2024-04-01T00:00:00.000Z')
        await knexDatabase('statuses').insert({
          id: legacyAnnounceId,
          url: null,
          urlHash: null,
          actorId: ACTOR2_ID,
          type: StatusType.enum.Announce,
          reply: '',
          content: statusId,
          originalStatusId: null,
          createdAt,
          updatedAt: createdAt
        })
        await knexDatabase('recipients').insert({
          id: crypto.randomUUID(),
          statusId: legacyAnnounceId,
          actorId: ACTIVITY_STREAM_PUBLIC,
          type: 'to',
          createdAt,
          updatedAt: createdAt
        })

        const response = await getStatusRebloggedBy(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblogged_by`
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )

        expect(response.status).toBe(200)
        const accounts = (await response.json()) as { id: string }[]
        expect(accounts.map((account) => account.id)).toEqual([
          urlToId(ACTOR2_ID)
        ])
      } finally {
        mockDatabase = previousDatabase
        await knexDatabase.destroy()
      }
    })

    it('exposes non-public boosts to authenticated actors they are addressed to', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-direct-boost`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public status with a direct boost',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      await database.createAnnounce({
        id: `${ACTOR3_ID}/statuses/api-reblogged-by-direct-boost`,
        actorId: ACTOR3_ID,
        to: [ACTOR2_ID],
        cc: [],
        originalStatusId: statusId
      })

      mockGetServerSession.mockResolvedValue(null)
      const anonymousResponse = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblogged_by`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(anonymousResponse.status).toBe(200)
      await expect(anonymousResponse.json()).resolves.toEqual([])

      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })
      const authenticatedResponse = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblogged_by`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(authenticatedResponse.status).toBe(200)
      const accounts = (await authenticatedResponse.json()) as { id: string }[]
      expect(accounts.map((account) => account.id)).toEqual([
        urlToId(ACTOR3_ID)
      ])
    })

    it.each([
      // The route requests limit + 1 to detect a next page, so the clamped
      // limit (1 / 80 / fallback 40) reaches the DB as 2 / 81 / 41.
      ['0', 2],
      ['81', 81],
      ['abc', 41]
    ])(
      'clamps out-of-range limit=%s instead of rejecting it',
      async (limit, expectedDbLimit) => {
        mockGetServerSession.mockResolvedValue(null)
        const getRebloggedBySpy = vi.spyOn(database, 'getRebloggedBy')

        const statusId = `${ACTOR1_ID}/statuses/post-1`
        const response = await getStatusRebloggedBy(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(
              statusId
            )}/reblogged_by?limit=${limit}`
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )

        expect(response.status).toBe(200)
        expect(getRebloggedBySpy).toHaveBeenCalledWith(
          expect.objectContaining({ limit: expectedDbLimit })
        )

        getRebloggedBySpy.mockRestore()
      }
    )

    it.each(['max_id', 'since_id'] as const)(
      'returns an empty page for an invalid %s cursor',
      async (cursor) => {
        mockGetServerSession.mockResolvedValue(null)

        const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-invalid-${cursor}`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: ACTOR1_ID,
          text: 'Public status with invalid cursor reblog',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })
        await database.createAnnounce({
          id: `${ACTOR2_ID}/statuses/api-reblogged-by-invalid-${cursor}`,
          actorId: ACTOR2_ID,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: statusId
        })

        const requestUrl = new URL(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblogged_by`
        )
        requestUrl.searchParams.set(
          cursor,
          urlToId(`${ACTOR2_ID}/statuses/api-reblogged-by-missing-cursor`)
        )

        const response = await getStatusRebloggedBy(
          new NextRequest(requestUrl.toString()),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual([])
        expect(response.headers.get('Link')).toBeNull()
      }
    )

    it('returns not found when the status does not exist', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-missing`
      const response = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblogged_by`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(404)
    })

    it('omits next pagination link on the last nonempty page', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-last-page`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public status with last-page reblogs',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const olderAnnounceId = `${ACTOR2_ID}/statuses/api-reblogged-by-last-page-older`
      const newerAnnounceId = `${ACTOR3_ID}/statuses/api-reblogged-by-last-page-newer`
      await database.createAnnounce({
        id: olderAnnounceId,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-02-01T00:00:00.000Z')
      })
      await database.createAnnounce({
        id: newerAnnounceId,
        actorId: ACTOR3_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-02-02T00:00:00.000Z')
      })

      const response = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(
            statusId
          )}/reblogged_by?limit=3&max_id=${urlToId(newerAnnounceId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const accounts = (await response.json()) as { id: string }[]
      expect(accounts.map((account) => account.id)).toEqual([
        urlToId(ACTOR2_ID)
      ])

      const linkHeader = response.headers.get('Link')
      expect(linkHeader).not.toEqual(expect.stringContaining('rel="next"'))
      expect(linkHeader).toEqual(expect.stringContaining('rel="prev"'))
    })

    it('omits pagination links when no trusted host is configured', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const { getConfig } = await vi.importMock<{ getConfig: jest.Mock }>(
        '@/lib/config'
      )
      getConfig.mockReturnValue({
        allowEmails: [],
        host: '',
        secretPhase: 'test-secret'
      })

      try {
        const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-empty-host`
        await database.createNote({
          id: statusId,
          url: statusId,
          actorId: ACTOR1_ID,
          text: 'Public status with pagination and empty configured host',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: []
        })

        const olderAnnounceId = `${ACTOR2_ID}/statuses/api-reblogged-by-empty-host-older`
        const newerAnnounceId = `${ACTOR3_ID}/statuses/api-reblogged-by-empty-host-newer`
        await database.createAnnounce({
          id: olderAnnounceId,
          actorId: ACTOR2_ID,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: statusId,
          createdAt: Date.parse('2024-05-01T00:00:00.000Z')
        })
        await database.createAnnounce({
          id: newerAnnounceId,
          actorId: ACTOR3_ID,
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          originalStatusId: statusId,
          createdAt: Date.parse('2024-05-02T00:00:00.000Z')
        })

        const response = await getStatusRebloggedBy(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(
              statusId
            )}/reblogged_by?limit=1`
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )

        expect(response.status).toBe(200)
        const accounts = (await response.json()) as { id: string }[]
        expect(accounts.map((account) => account.id)).toEqual([
          urlToId(ACTOR3_ID)
        ])
        expect(response.headers.get('Link')).toBeNull()
      } finally {
        getConfig.mockReturnValue({
          allowEmails: [],
          host: 'llun.test',
          secretPhase: 'test-secret'
        })
      }
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

  describe('conversation mute/unmute', () => {
    it('mutes and unmutes a conversation, reflecting the muted flag', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-mute-conversation`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Conversation root to mute',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const muteResponse = await muteStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/mute`,
          { method: 'POST', headers: { Origin: 'https://llun.test' } }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      expect(muteResponse.status).toBe(200)
      await expect(muteResponse.json()).resolves.toMatchObject({
        id: urlToId(statusId),
        muted: true
      })

      const unmuteResponse = await unmuteStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/unmute`,
          { method: 'POST', headers: { Origin: 'https://llun.test' } }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      expect(unmuteResponse.status).toBe(200)
      await expect(unmuteResponse.json()).resolves.toMatchObject({
        id: urlToId(statusId),
        muted: false
      })
    })

    it('marks a reply muted when its thread root is muted', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor2.email }
      })

      const rootId = `${ACTOR1_ID}/statuses/api-mute-thread-root`
      const replyId = `${ACTOR1_ID}/statuses/api-mute-thread-reply`
      await database.createNote({
        id: rootId,
        url: rootId,
        actorId: ACTOR1_ID,
        text: 'Thread root',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: replyId,
        url: replyId,
        actorId: ACTOR1_ID,
        text: 'A reply in the thread',
        reply: rootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      // Mute via the reply; Mastodon mutes the whole conversation.
      await muteStatus(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(replyId)}/mute`,
          { method: 'POST', headers: { Origin: 'https://llun.test' } }
        ),
        { params: Promise.resolve({ id: urlToId(replyId) }) }
      )

      const rootResponse = await GET(
        new NextRequest(`https://llun.test/api/v1/statuses/${urlToId(rootId)}`),
        { params: Promise.resolve({ id: urlToId(rootId) }) }
      )
      await expect(rootResponse.json()).resolves.toMatchObject({ muted: true })
    })
  })

  describe('full context tree', () => {
    it('returns the full ancestor chain root-first and recursive descendants', async () => {
      const rootId = `${ACTOR1_ID}/statuses/api-context-root`
      const childId = `${ACTOR1_ID}/statuses/api-context-child`
      const grandchildId = `${ACTOR1_ID}/statuses/api-context-grandchild`
      await database.createNote({
        id: rootId,
        url: rootId,
        actorId: ACTOR1_ID,
        text: 'Root',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: childId,
        url: childId,
        actorId: ACTOR1_ID,
        text: 'Child',
        reply: rootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: grandchildId,
        url: grandchildId,
        actorId: ACTOR1_ID,
        text: 'Grandchild',
        reply: childId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      // Context of the middle node: one ancestor (root), one descendant (grandchild).
      const response = await getStatusContext(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(childId)}/context`
        ),
        { params: Promise.resolve({ id: urlToId(childId) }) }
      )
      expect(response.status).toBe(200)
      const context = await response.json()
      expect(context.ancestors.map((s: { id: string }) => s.id)).toEqual([
        urlToId(rootId)
      ])
      expect(context.descendants.map((s: { id: string }) => s.id)).toEqual([
        urlToId(grandchildId)
      ])
    })
  })

  describe('status edit history', () => {
    it('returns the full StatusEdit timeline oldest-first including the original', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-history-edits`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Version one',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.updateNote({ statusId, text: 'Version two' })
      await database.updateNote({ statusId, text: 'Version three' })

      const response = await getStatusHistory(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/history`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      expect(response.status).toBe(200)
      const history = await response.json()
      expect(history).toHaveLength(3)
      expect(history[0].content).toContain('Version one')
      expect(history[2].content).toContain('Version three')
      // created_at is non-decreasing oldest→newest (a bug giving every revision
      // the same timestamp from the wrong column would break ordering).
      const timestamps = history.map((edit: { created_at: string }) =>
        Date.parse(edit.created_at)
      )
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1])
      }
      for (const edit of history) {
        expect(edit).toMatchObject({
          spoiler_text: expect.any(String),
          sensitive: expect.any(Boolean),
          created_at: expect.any(String),
          account: expect.objectContaining({ id: urlToId(ACTOR1_ID) }),
          media_attachments: expect.any(Array),
          emojis: expect.any(Array)
        })
      }
    })

    it('returns a single edit for a never-edited status', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-history-unedited`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Only version',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await getStatusHistory(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/history`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      expect(response.status).toBe(200)
      const history = await response.json()
      expect(history).toHaveLength(1)
      expect(history[0].content).toContain('Only version')
    })
  })

  describe('favourited_by id-cursor pagination', () => {
    it('paginates with limit and emits a Link header with max_id/since_id', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-favourited-by-pagination`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Favourited by several actors',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createLike({ actorId: ACTOR1_ID, statusId })
      await database.createLike({ actorId: ACTOR2_ID, statusId })
      await database.createLike({ actorId: ACTOR3_ID, statusId })

      const firstPage = await getStatusFavouritedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/favourited_by?limit=2`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      expect(firstPage.status).toBe(200)
      const firstAccounts = await firstPage.json()
      expect(firstAccounts).toHaveLength(2)

      const linkHeader = firstPage.headers.get('Link')
      expect(linkHeader).toContain('rel="next"')
      expect(linkHeader).toContain('max_id=')
      expect(linkHeader).toContain('rel="prev"')

      // No legacy offset/X-* headers remain.
      expect(firstPage.headers.get('X-Total-Count')).toBeNull()
    })

    it('returns the cursor-adjacent favourite (no gap) when paging forward with min_id', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-favourited-by-min-id`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Favourited for min_id paging',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createLike({ actorId: ACTOR1_ID, statusId })
      await database.createLike({ actorId: ACTOR2_ID, statusId })
      await database.createLike({ actorId: ACTOR3_ID, statusId })

      // Learn the descending (newest-first) order directly from storage.
      const ordered = await database.getFavouritedBy({ statusId, limit: 10 })
      expect(ordered).toHaveLength(3)
      const oldest = ordered[ordered.length - 1]
      const secondOldest = ordered[ordered.length - 2]

      // Page forward from the oldest favourite, one at a time. The item
      // immediately newer than the cursor must be returned (the off-by-one bug
      // would skip it and return the newest instead).
      const minIdCursor = encodeFavouritedByCursor({
        createdAt: oldest.createdAt,
        actorId: oldest.actorId
      })
      const page = await getStatusFavouritedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/favourited_by?limit=1&min_id=${encodeURIComponent(minIdCursor)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      expect(page.status).toBe(200)
      const accounts = await page.json()
      expect(accounts).toHaveLength(1)
      expect(accounts[0].id).toBe(urlToId(secondOldest.actorId))
    })

    it('emits rel=next (older) but omits rel=prev at the newest edge of a min_id page', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-favourited-by-min-id-edge`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Favourited for min_id edge paging',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createLike({ actorId: ACTOR1_ID, statusId })
      await database.createLike({ actorId: ACTOR2_ID, statusId })
      await database.createLike({ actorId: ACTOR3_ID, statusId })

      const ordered = await database.getFavouritedBy({ statusId, limit: 10 })
      expect(ordered).toHaveLength(3)
      const secondOldest = ordered[ordered.length - 2]

      // Page forward from the second-oldest: only one newer favourite (the
      // newest) remains, so the page is full but reaches the newest edge.
      const minIdCursor = encodeFavouritedByCursor({
        createdAt: secondOldest.createdAt,
        actorId: secondOldest.actorId
      })
      const page = await getStatusFavouritedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/favourited_by?limit=1&min_id=${encodeURIComponent(minIdCursor)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      expect(page.status).toBe(200)
      const accounts = await page.json()
      expect(accounts).toHaveLength(1)
      expect(accounts[0].id).toBe(urlToId(ordered[0].actorId))

      const linkHeader = page.headers.get('Link') ?? ''
      // Older favourites still exist (the cursor and below), so next must be
      // offered; there are no newer ones, so prev must be omitted.
      expect(linkHeader).toContain('rel="next"')
      expect(linkHeader).toContain('max_id=')
      expect(linkHeader).not.toContain('rel="prev"')
    })

    it.each([
      // The route requests limit + 1 to detect a next page, so the clamped
      // limit (1 / 80 / fallback 40) reaches the DB as 2 / 81 / 41.
      ['0', 2],
      ['81', 81],
      ['abc', 41]
    ])(
      'clamps out-of-range limit=%s instead of rejecting it',
      async (limit, expectedDbLimit) => {
        mockGetServerSession.mockResolvedValue(null)
        const getFavouritedBySpy = vi.spyOn(database, 'getFavouritedBy')

        const statusId = `${ACTOR1_ID}/statuses/post-1`
        const response = await getStatusFavouritedBy(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(
              statusId
            )}/favourited_by?limit=${limit}`
          ),
          { params: Promise.resolve({ id: urlToId(statusId) }) }
        )

        expect(response.status).toBe(200)
        expect(getFavouritedBySpy).toHaveBeenCalledWith(
          expect.objectContaining({ limit: expectedDbLimit })
        )

        getFavouritedBySpy.mockRestore()
      }
    )
  })

  describe('edit sensitive/language', () => {
    it('wires sensitive and language through a PUT edit', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-sensitive-language`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Edit me to mark sensitive',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({ sensitive: true, language: 'th' }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.sensitive).toBe(true)
      expect(data.language).toBe('th')

      // Persisted through a fresh read.
      const reread = await GET(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      await expect(reread.json()).resolves.toMatchObject({
        sensitive: true,
        language: 'th'
      })
    })
  })

  describe('context visibility filtering', () => {
    it('excludes unreadable ancestors/descendants for a non-follower but keeps readable ones', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor3.email }
      })

      const publicRootId = `${ACTOR1_ID}/statuses/api-context-vis-root`
      const privateMidId = `${ACTOR1_ID}/statuses/api-context-vis-private-mid`
      const publicTargetId = `${ACTOR1_ID}/statuses/api-context-vis-target`
      const privateDescId = `${ACTOR1_ID}/statuses/api-context-vis-private-desc`
      const publicDescId = `${ACTOR1_ID}/statuses/api-context-vis-public-desc`

      await database.createNote({
        id: publicRootId,
        url: publicRootId,
        actorId: ACTOR1_ID,
        text: 'Public root ancestor',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      // A private node in the middle of the chain: must be traversed through but
      // excluded from the response.
      await database.createNote({
        id: privateMidId,
        url: privateMidId,
        actorId: ACTOR1_ID,
        text: 'Private mid ancestor',
        reply: publicRootId,
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })
      await database.createNote({
        id: publicTargetId,
        url: publicTargetId,
        actorId: ACTOR1_ID,
        text: 'Public target',
        reply: privateMidId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: privateDescId,
        url: privateDescId,
        actorId: ACTOR1_ID,
        text: 'Private descendant',
        reply: publicTargetId,
        to: [`${ACTOR1_ID}/followers`],
        cc: []
      })
      await database.createNote({
        id: publicDescId,
        url: publicDescId,
        actorId: ACTOR1_ID,
        text: 'Public descendant',
        reply: publicTargetId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await getStatusContext(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(publicTargetId)}/context`
        ),
        { params: Promise.resolve({ id: urlToId(publicTargetId) }) }
      )
      expect(response.status).toBe(200)
      const context = await response.json()

      const ancestorIds = context.ancestors.map((s: { id: string }) => s.id)
      const descendantIds = context.descendants.map((s: { id: string }) => s.id)

      // The private mid ancestor is excluded, but the public root above it
      // remains (the chain is not cut short).
      expect(ancestorIds).toContain(urlToId(publicRootId))
      expect(ancestorIds).not.toContain(urlToId(privateMidId))

      // The private descendant is excluded; the public sibling remains.
      expect(descendantIds).toContain(urlToId(publicDescId))
      expect(descendantIds).not.toContain(urlToId(privateDescId))
    })
  })

  describe('filter annotation on single status and context reads', () => {
    beforeAll(async () => {
      await database.createFilter({
        actorId: ACTOR1_ID,
        title: 'Spoilers',
        context: ['thread'],
        filterAction: 'warn',
        expiresAt: null,
        keywords: [{ keyword: 'spoiler', wholeWord: false }]
      })
    })

    it('annotates the filtered field on a single status the active filter matches', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-filter-single-match`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'this contains a spoiler about the ending',
        to: [ACTIVITY_STREAM_PUBLIC],
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
      expect(data.filtered).toHaveLength(1)
      expect(data.filtered[0].filter.title).toBe('Spoilers')
      expect(data.filtered[0].keyword_matches).toEqual(['spoiler'])
    })

    it('leaves filtered empty for a status the active filter does not match', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const statusId = `${ACTOR1_ID}/statuses/api-filter-single-nomatch`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'an ordinary post with nothing notable',
        to: [ACTIVITY_STREAM_PUBLIC],
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
      expect(data.filtered ?? []).toHaveLength(0)
    })

    it('does not annotate filtered for anonymous single status reads', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-filter-single-anonymous`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'this contains a spoiler for anonymous readers',
        to: [ACTIVITY_STREAM_PUBLIC],
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
      expect(data.filtered ?? []).toHaveLength(0)
    })

    it('annotates filtered on matching ancestors and descendants in the context response', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })

      const rootId = `${ACTOR1_ID}/statuses/api-filter-context-root`
      const targetId = `${ACTOR1_ID}/statuses/api-filter-context-target`
      const descId = `${ACTOR1_ID}/statuses/api-filter-context-desc`
      await database.createNote({
        id: rootId,
        url: rootId,
        actorId: ACTOR1_ID,
        text: 'root status with a spoiler in it',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: targetId,
        url: targetId,
        actorId: ACTOR1_ID,
        text: 'target status replying to the root',
        reply: rootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: descId,
        url: descId,
        actorId: ACTOR1_ID,
        text: 'descendant reply that also has a spoiler',
        reply: targetId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await getStatusContext(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(targetId)}/context`
        ),
        { params: Promise.resolve({ id: urlToId(targetId) }) }
      )

      expect(response.status).toBe(200)
      const context = await response.json()

      const ancestor = context.ancestors.find(
        (s: { id: string }) => s.id === urlToId(rootId)
      )
      expect(ancestor.filtered).toHaveLength(1)
      expect(ancestor.filtered[0].filter.title).toBe('Spoilers')

      const descendant = context.descendants.find(
        (s: { id: string }) => s.id === urlToId(descId)
      )
      expect(descendant.filtered).toHaveLength(1)
      expect(descendant.filtered[0].filter.title).toBe('Spoilers')
    })

    it('does not annotate filtered for anonymous context reads', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const rootId = `${ACTOR1_ID}/statuses/api-filter-context-anon-root`
      const targetId = `${ACTOR1_ID}/statuses/api-filter-context-anon-target`
      await database.createNote({
        id: rootId,
        url: rootId,
        actorId: ACTOR1_ID,
        text: 'root status with a spoiler for anonymous context readers',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createNote({
        id: targetId,
        url: targetId,
        actorId: ACTOR1_ID,
        text: 'target status replying to the anonymous root',
        reply: rootId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await getStatusContext(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(targetId)}/context`
        ),
        { params: Promise.resolve({ id: urlToId(targetId) }) }
      )

      expect(response.status).toBe(200)
      const context = await response.json()

      const ancestor = context.ancestors.find(
        (s: { id: string }) => s.id === urlToId(rootId)
      )
      expect(ancestor.filtered ?? []).toHaveLength(0)
    })
  })
})
