import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/statuses/[id]/reblogged_by', () => {
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
    mockGetServerSession.mockResolvedValue(null)
  })

  it('returns newer reblogs when paging with min_id', async () => {
    const statusId = `${ACTOR1_ID}/statuses/reblogged-by-min-id-test`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Status for min_id reblogged_by test',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    // Three announces from different actors with distinct timestamps so we can
    // confirm min_id returns only the oldest-of-newer (middle) band, not the
    // newest (which a plain limit=1 without min_id would return).
    const oldestAnnounceId = `${ACTOR2_ID}/statuses/reblogged-by-min-id-oldest`
    const middleAnnounceId = `${ACTOR3_ID}/statuses/reblogged-by-min-id-middle`
    const newestAnnounceId = `${ACTOR4_ID}/statuses/reblogged-by-min-id-newest`
    await database.createAnnounce({
      id: oldestAnnounceId,
      actorId: ACTOR2_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: statusId,
      createdAt: Date.parse('2024-10-01T00:00:00.000Z')
    })
    await database.createAnnounce({
      id: middleAnnounceId,
      actorId: ACTOR3_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: statusId,
      createdAt: Date.parse('2024-10-02T00:00:00.000Z')
    })
    await database.createAnnounce({
      id: newestAnnounceId,
      actorId: ACTOR4_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: statusId,
      createdAt: Date.parse('2024-10-03T00:00:00.000Z')
    })

    // min_id=oldest, limit=1 should return only ACTOR3 (the announce
    // immediately above the cursor). Without min_id, limit=1 returns ACTOR4
    // (the overall newest).
    const req = new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/reblogged_by?min_id=${urlToId(oldestAnnounceId)}&limit=1`
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: urlToId(statusId) })
    })
    expect(response.status).toBe(200)
    const accounts = (await response.json()) as { id: string }[]
    expect(accounts).toHaveLength(1)
    expect(accounts[0].id).toBe(urlToId(ACTOR3_ID))
  })
})
