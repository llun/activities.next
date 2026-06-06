import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => undefined
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({ verifyAccessToken: jest.fn() }))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const createRequest = (targetId: string, query = '') =>
  new NextRequest(
    `https://llun.test/api/v1/accounts/${urlToId(targetId)}/followers${query}`,
    { method: 'GET', headers: { host: 'llun.test' } }
  )

describe('GET /api/v1/accounts/:id/followers', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    // Public endpoint: unauthenticated by default.
    mockGetServerSession.mockResolvedValue(null)
  })

  it('returns the accepted followers without authentication', async () => {
    // Actor2 followers: EXTERNAL_ACTOR1 and Actor3 (both accepted, real actors).
    const response = await GET(createRequest(ACTOR2_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR2_ID) })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThanOrEqual(2)
    expect(data[0]).toHaveProperty('id')
    expect(data[0]).toHaveProperty('acct')
  })

  it('emits Mastodon Link pagination headers', async () => {
    const response = await GET(createRequest(ACTOR2_ID, '?limit=1'), {
      params: Promise.resolve({ id: urlToId(ACTOR2_ID) })
    })

    expect(response.status).toBe(200)
    const link = response.headers.get('Link')
    expect(link).toContain('rel="next"')
    expect(link).toContain('max_id=')
    expect(link).toContain('rel="prev"')
    expect(link).toContain('min_id=')
  })

  it('paginates forward with min_id and returns newest-first', async () => {
    // Follow rows are ordered by id desc; the oldest is the last one.
    const allFollows = await database.getFollowers({
      targetActorId: ACTOR2_ID,
      limit: 80
    })
    expect(allFollows.length).toBeGreaterThanOrEqual(2)
    const oldestFollowId = allFollows[allFollows.length - 1].id
    const newestActorId = allFollows[0].actorId

    const response = await GET(
      createRequest(ACTOR2_ID, `?min_id=${oldestFollowId}`),
      { params: Promise.resolve({ id: urlToId(ACTOR2_ID) }) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    // Only the rows newer than the oldest cursor, presented newest-first.
    expect(data.length).toBe(allFollows.length - 1)
    expect(data[0].id).toBe(urlToId(newestActorId))
    const link = response.headers.get('Link')
    expect(link).toContain('rel="next"')
    expect(link).toContain('rel="prev"')
  })

  it('returns 404 for an unknown account', async () => {
    const unknown = 'https://llun.test/users/nope'
    const response = await GET(createRequest(unknown), {
      params: Promise.resolve({ id: urlToId(unknown) })
    })
    expect(response.status).toBe(404)
  })
})
