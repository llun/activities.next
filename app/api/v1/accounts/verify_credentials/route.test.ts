import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET } from './route'

const hashToken = (token: string) =>
  crypto
    .createHash('sha256')
    .update(token)
    .digest()
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const mockStoredTokens = new Map<string, Record<string, unknown>>()

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => (_table: string) => ({
    where: (_field: string, value: string) => ({
      first: () => Promise.resolve(mockStoredTokens.get(value) ?? null)
    })
  })
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({ verifyAccessToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const createRequest = () =>
  new NextRequest('https://llun.test/api/v1/accounts/verify_credentials', {
    method: 'GET'
  })

describe('GET /api/v1/accounts/verify_credentials', () => {
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
    vi.clearAllMocks()
    mockStoredTokens.clear()
  })

  const setToken = (token: string, scopes: string[]) => {
    mockStoredTokens.set(hashToken(token), {
      token: hashToken(token),
      referenceId: ACTOR1_ID,
      clientId: 'client-app-1',
      expiresAt: new Date(Date.now() + 3600000),
      scopes: JSON.stringify(scopes)
    })
  }

  const createTokenRequest = (token: string) =>
    new NextRequest('https://llun.test/api/v1/accounts/verify_credentials', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
  })

  it('returns a CredentialAccount with source and role', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const response = await GET(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        source: expect.objectContaining({
          note: expect.any(String),
          privacy: expect.any(String),
          follow_requests_count: expect.any(Number)
        }),
        role: expect.objectContaining({
          id: expect.any(String),
          permissions: expect.any(String)
        })
      })
    )
    // Actor1 has one pending follow request (Actor5) in the seed graph.
    expect(data.source.follow_requests_count).toBeGreaterThanOrEqual(1)
  })

  it('omits source and role for a profile-scope-only token', async () => {
    // Mastodon's narrow `profile` scope grants verify_credentials but the
    // response must not leak source (default prefs, follow_requests_count) or
    // role. Force the bearer path by leaving the cookie session null.
    mockGetServerSession.mockResolvedValue(null)
    setToken('profile-token', ['profile'])

    const response = await GET(createTokenRequest('profile-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.id).toEqual(expect.any(String))
    expect(data.source).toBeUndefined()
    expect(data.role).toBeUndefined()
  })

  it('includes source and role for a read:accounts token', async () => {
    mockGetServerSession.mockResolvedValue(null)
    setToken('read-token', ['read:accounts'])

    const response = await GET(createTokenRequest('read-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.source).toEqual(
      expect.objectContaining({ privacy: expect.any(String) })
    )
    expect(data.role).toEqual(
      expect.objectContaining({ id: expect.any(String) })
    )
  })
})
