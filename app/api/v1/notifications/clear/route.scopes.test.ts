import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { POST } from './route'

// Real-guard scope test for a representative granular WRITE route
// (write:notifications). Complements preferences/route.test.ts (a read route)
// so both scope directions have end-to-end, non-mocked-guard coverage; the
// other swapped routes share the identical OAuthGuardAnyScope mechanism, which
// is unit-tested in lib/services/guards/OAuthGuard.test.ts.

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

describe('POST /api/v1/notifications/clear scope enforcement', () => {
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
    // Force the bearer/OAuth path (the cookie path skips scope checks).
    mockGetServerSession.mockResolvedValue(null)
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

  const request = (token: string) =>
    new NextRequest('https://llun.test/api/v1/notifications/clear', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })

  it.each(['write', 'write:notifications'])(
    'accepts a bearer token granted only the %s scope',
    async (scope) => {
      setToken('clear-token', [scope])
      const response = await POST(request('clear-token'), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(200)
    }
  )

  it('rejects a bearer token granted only an unrelated scope', async () => {
    setToken('unrelated-token', ['read:statuses'])
    const response = await POST(request('unrelated-token'), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(401)
  })
})
