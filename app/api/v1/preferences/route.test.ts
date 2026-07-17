import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

import { GET } from './route'

// Mirrors the SHA-256 base64url hashing the guard applies before the DB lookup.
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
  // The OAuth bearer path looks the token up via getKnex(); return the
  // in-memory token store so scope tests can exercise the real guard.
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

describe('/api/v1/preferences', () => {
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
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
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

  it('GET requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/preferences'),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(401)
  })

  it('returns the documented default payload when no preferences are set', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/preferences'),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      'posting:default:visibility': 'public',
      'posting:default:sensitive': false,
      'posting:default:language': null,
      'posting:default:quote_policy': 'public',
      'reading:expand:media': 'default',
      'reading:expand:spoilers': false,
      'reading:autoplay:gifs': false
    })
  })

  it('reflects the actor posting defaults and reading preferences', async () => {
    await database.updateActor({
      actorId: ACTOR1_ID,
      defaultPrivacy: 'private',
      defaultSensitive: true,
      defaultLanguage: 'th',
      defaultQuotePolicy: 'followers',
      readingExpandMedia: 'show_all',
      readingExpandSpoilers: true,
      readingAutoplayGifs: true
    })
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/preferences'),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      'posting:default:visibility': 'private',
      'posting:default:sensitive': true,
      'posting:default:language': 'th',
      'posting:default:quote_policy': 'followers',
      'reading:expand:media': 'show_all',
      'reading:expand:spoilers': true,
      'reading:autoplay:gifs': true
    })
  })

  // The guard now accepts the aggregate `read` scope OR the granular
  // `read:accounts` scope (OAuthGuardAnyScope). An unrelated granular read
  // scope must still be rejected.
  it.each(['read', 'read:accounts'])(
    'GET accepts a bearer token granted only the %s scope',
    async (scope) => {
      mockGetServerSession.mockResolvedValue(null)
      setToken('prefs-token', [scope])
      const response = await GET(
        new NextRequest('https://llun.test/api/v1/preferences', {
          headers: { Authorization: 'Bearer prefs-token' }
        }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(200)
    }
  )

  it('GET rejects a bearer token granted only an unrelated scope', async () => {
    mockGetServerSession.mockResolvedValue(null)
    setToken('unrelated-token', ['read:statuses'])
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/preferences', {
        headers: { Authorization: 'Bearer unrelated-token' }
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(401)
  })
})
