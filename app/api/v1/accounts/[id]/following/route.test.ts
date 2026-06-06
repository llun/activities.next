import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
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
    `https://llun.test/api/v1/accounts/${urlToId(targetId)}/following${query}`,
    { method: 'GET', headers: { host: 'llun.test' } }
  )

describe('GET /api/v1/accounts/:id/following', () => {
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

  it('returns the accounts the user follows without authentication', async () => {
    // Actor3 follows Actor2 and Actor4 (both accepted, real local actors).
    const response = await GET(createRequest(ACTOR3_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR3_ID) })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.length).toBeGreaterThanOrEqual(2)
    expect(data[0]).toHaveProperty('id')
    expect(data[0]).toHaveProperty('acct')
  })

  it('emits Mastodon Link pagination headers', async () => {
    const response = await GET(createRequest(ACTOR3_ID, '?limit=1'), {
      params: Promise.resolve({ id: urlToId(ACTOR3_ID) })
    })

    expect(response.status).toBe(200)
    const link = response.headers.get('Link')
    expect(link).toContain('rel="next"')
    expect(link).toContain('max_id=')
    expect(link).toContain('rel="prev"')
    expect(link).toContain('min_id=')
  })

  it('returns 404 for an unknown account', async () => {
    const unknown = 'https://llun.test/users/nope'
    const response = await GET(createRequest(unknown), {
      params: Promise.resolve({ id: urlToId(unknown) })
    })
    expect(response.status).toBe(404)
  })
})
