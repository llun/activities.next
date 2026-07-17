import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
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

describe('GET /api/v1/statuses/[id]/quotes', () => {
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

  const createQuotingStatus = async (
    quotingId: string,
    actorId: string,
    quotedStatusId: string,
    state: 'accepted' | 'pending' | 'rejected'
  ) => {
    await database.createNote({
      id: quotingId,
      url: quotingId,
      actorId,
      text: 'a quoting post',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createStatusQuote({
      statusId: quotingId,
      quotedStatusId,
      state
    })
  }

  it('lists accepted quotes of a status, excluding non-accepted edges', async () => {
    const quotedId = `${ACTOR1_ID}/statuses/quotes-target-1`
    await database.createNote({
      id: quotedId,
      url: quotedId,
      actorId: ACTOR1_ID,
      text: 'quote me',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const acceptedQuoteId = `${ACTOR2_ID}/statuses/quotes-accepted-1`
    await createQuotingStatus(acceptedQuoteId, ACTOR2_ID, quotedId, 'accepted')
    const pendingQuoteId = `${ACTOR3_ID}/statuses/quotes-pending-1`
    await createQuotingStatus(pendingQuoteId, ACTOR3_ID, quotedId, 'pending')

    const req = new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(quotedId)}/quotes`
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: urlToId(quotedId) })
    })

    expect(response.status).toBe(200)
    const statuses = (await response.json()) as { id: string }[]
    expect(statuses.map((status) => status.id)).toEqual([
      urlToId(acceptedQuoteId)
    ])
  })

  it('404s when the quoted status does not exist', async () => {
    const req = new NextRequest(
      'https://llun.test/api/v1/statuses/does-not-exist/quotes'
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: 'does-not-exist' })
    })
    expect(response.status).toBe(404)
  })

  it('paginates with limit and emits a next Link header when more remain', async () => {
    const quotedId = `${ACTOR1_ID}/statuses/quotes-target-2`
    await database.createNote({
      id: quotedId,
      url: quotedId,
      actorId: ACTOR1_ID,
      text: 'popular post',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await createQuotingStatus(
      `${ACTOR2_ID}/statuses/quotes-page-a`,
      ACTOR2_ID,
      quotedId,
      'accepted'
    )
    await createQuotingStatus(
      `${ACTOR3_ID}/statuses/quotes-page-b`,
      ACTOR3_ID,
      quotedId,
      'accepted'
    )

    const req = new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(quotedId)}/quotes?limit=1`
    )
    const response = await GET(req, {
      params: Promise.resolve({ id: urlToId(quotedId) })
    })

    expect(response.status).toBe(200)
    const statuses = (await response.json()) as { id: string }[]
    expect(statuses).toHaveLength(1)
    expect(response.headers.get('Link')).toContain('max_id=')
  })
})
