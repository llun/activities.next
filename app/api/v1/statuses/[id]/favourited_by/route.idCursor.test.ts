import { NextRequest } from 'next/server'

import { encodeFavouritedByCursor } from '@/lib/database/sql/utils/favouritedByCursor'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { actorPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET as getStatusFavouritedBy } from './route'

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
      expect(accounts[0].id).toBe(
        await actorPublicId(database, secondOldest.actorId)
      )
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
      expect(accounts[0].id).toBe(
        await actorPublicId(database, ordered[0].actorId)
      )

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
})
