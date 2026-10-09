import knex from 'knex'
import { NextRequest } from 'next/server'

import { getSQLDatabase } from '@/lib/database/sql'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { actorPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET as getStatusRebloggedBy } from './route'

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
      const olderAnnounce = await database.createAnnounce({
        id: olderAnnounceId,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-01-01T00:00:00.000Z')
      })
      const newerAnnounce = await database.createAnnounce({
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
        await actorPublicId(database, ACTOR3_ID)
      ])
      expect(firstResponse.headers.get('Link')).toEqual(
        expect.stringContaining(
          `max_id=${encodeURIComponent(newerAnnounce!.publicId!)}`
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
        await actorPublicId(database, ACTOR2_ID)
      ])
      const nextLinkHeader = nextResponse.headers.get('Link')
      expect(nextLinkHeader).not.toEqual(expect.stringContaining('rel="next"'))
      expect(nextLinkHeader).toEqual(
        expect.stringContaining(
          `since_id=${encodeURIComponent(olderAnnounce!.publicId!)}`
        )
      )
    })

    it('pages with the publicId max_id cursor it advertised', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const statusId = `${ACTOR1_ID}/statuses/api-reblogged-by-roundtrip`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Public status with reblogs to page over',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createAnnounce({
        id: `${ACTOR2_ID}/statuses/api-reblogged-by-roundtrip-older`,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-08-01T00:00:00.000Z')
      })
      const newerAnnounce = await database.createAnnounce({
        id: `${ACTOR3_ID}/statuses/api-reblogged-by-roundtrip-newer`,
        actorId: ACTOR3_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId: statusId,
        createdAt: Date.parse('2024-08-02T00:00:00.000Z')
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
      const advertisedMaxId = new URL(
        firstResponse.headers
          .get('Link')!
          .split(', ')
          .find((part) => part.includes('rel="next"'))!
          .match(/<([^>]+)>/)![1]
      ).searchParams.get('max_id')
      expect(advertisedMaxId).toBe(newerAnnounce!.publicId)

      // Feed the advertised publicId cursor straight back in.
      const nextResponse = await getStatusRebloggedBy(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(
            statusId
          )}/reblogged_by?limit=1&max_id=${advertisedMaxId}`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      expect(nextResponse.status).toBe(200)
      const nextPage = (await nextResponse.json()) as { id: string }[]
      const actor2 = await database.getActorFromId({ id: ACTOR2_ID })
      expect(nextPage.map((account) => account.id)).toEqual([actor2!.publicId])
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
      const newerDuplicateAnnounce = await database.createAnnounce({
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
        await actorPublicId(database, ACTOR2_ID),
        await actorPublicId(database, ACTOR3_ID)
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
          `max_id=${encodeURIComponent(newerDuplicateAnnounce!.publicId!)}`
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
        await actorPublicId(database, ACTOR3_ID)
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
      const cursorAnnounce = await database.createAnnounce({
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
          `max_id=${encodeURIComponent(cursorAnnounce!.publicId!)}`
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
        await actorPublicId(database, ACTOR3_ID)
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
        await actorPublicId(database, ACTOR2_ID)
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
        await actorPublicId(database, ACTOR2_ID)
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
          await actorPublicId(sqlDatabase, ACTOR2_ID)
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
        await actorPublicId(database, ACTOR3_ID)
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
        await actorPublicId(database, ACTOR2_ID)
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
          await actorPublicId(database, ACTOR3_ID)
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
})
