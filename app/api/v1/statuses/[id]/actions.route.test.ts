import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { MAX_PINNED_STATUSES } from '@/lib/services/mastodon/constants'
import { seedDatabase } from '@/lib/stub/database'
import { statusPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID, seedActor3 } from '@/lib/stub/seed/actor3'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { POST as bookmarkStatus } from './bookmark/route'
import { GET as getStatusContext } from './context/route'
import { POST as favouriteStatus } from './favourite/route'
import { GET as getStatusFavouritedBy } from './favourited_by/route'
import { GET as getStatusHistory } from './history/route'
import { POST as muteStatus } from './mute/route'
import { POST as pinStatus } from './pin/route'
import { POST as reblogStatus } from './reblog/route'
import { GET as getStatusRebloggedBy } from './reblogged_by/route'
import { GET } from './route'
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
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

// No `deleteStatus` here on purpose: status deletion federates through
// SendDeleteNoteJob now, so the request path never reaches the sender.
vi.mock('@/lib/activities', async () => ({
  sendLike: vi.fn().mockResolvedValue(undefined),
  sendUndoLike: vi.fn().mockResolvedValue(undefined)
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
      // The undo is acknowledged without echoing the now-private original.
      expect(JSON.stringify(await response.json())).not.toContain(
        'becomes private after a reblog'
      )
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
      // Sorted before comparing: `cc` is an ActivityPub audience, which is
      // unordered by definition, and the recipients are read back without an
      // ORDER BY — so which index the backend picks decides the array order.
      // Every consumer treats these as sets (see lib/services/federation/
      // statusDelivery.ts), so asserting a sequence only pinned an
      // implementation detail. Sorted arrays rather than Sets, because a Set
      // would also stop this catching a duplicated recipient.
      expect([...(announce?.cc ?? [])].sort()).toEqual(
        [ACTIVITY_STREAM_PUBLIC, ACTOR2_ID].sort()
      )
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
      // Sorted for the same reason as the unlisted-boost case above: the
      // recipients read has no ORDER BY. This one happened to keep passing only
      // because `ACTOR2_ID` sorts before its own `/followers` suffix.
      expect([...(announce?.cc ?? [])].sort()).toEqual(
        [ACTOR2_ID, `${ACTOR2_ID}/followers`].sort()
      )
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
        id: await statusPublicId(database, statusId),
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
        id: await statusPublicId(database, statusId),
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
        id: await statusPublicId(database, statusId),
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
        id: await statusPublicId(database, statusId),
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
        id: await statusPublicId(database, neverPinnedStatusId),
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
        id: await statusPublicId(database, pinnedStatusIds[0]),
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
        id: await statusPublicId(database, statusId),
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
        id: await statusPublicId(database, statusId),
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
        id: await statusPublicId(database, statusId),
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
})
