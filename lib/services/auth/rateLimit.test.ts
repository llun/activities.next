import bcrypt from 'bcrypt'
import { sql } from 'kysely'

import { resetTrustProxyIpHeadersConfigCacheForTests } from '@/lib/config/trustProxyIpHeaders'
import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'
import {
  SIGN_IN_EMAIL_LIMIT,
  resetRouteRateLimitsForTests
} from '@/lib/services/auth/routeRateLimits'

const HOST = 'test.example.com'
const SECOND_HOST = 'second.example.com'
const BASE_URL = `https://${HOST}`
const SECOND_BASE_URL = `https://${SECOND_HOST}`
const EMAIL = 'signin-limit@example.com'
const SIGN_IN_PER_IP_LIMIT = 25
const PASSWORD = 'correct-password-123'
const TEST_BCRYPT_COST = 4

const holder = vi.hoisted(() => ({
  testDb: null as TestDatabase | null
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: HOST,
    serviceName: 'Activities.next Test',
    secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
    trustedHosts: [SECOND_HOST],
    auth: { enableCredential: true }
  }),
  getBaseURL: () => BASE_URL
}))

vi.mock('@/lib/database', () => ({
  getKysely: () => holder.testDb?.db,
  getDatabase: () => holder.testDb?.database ?? null
}))

describe('better-auth rate limits', () => {
  beforeAll(async () => {
    const testDb = createTestDatabase()
    await testDb.prepare()
    await testDb.database.migrate()
    holder.testDb = testDb

    const passwordHash = await bcrypt.hash(PASSWORD, TEST_BCRYPT_COST)
    await testDb.database.createAccount({
      email: EMAIL,
      username: 'signinlimit',
      passwordHash,
      domain: HOST,
      privateKey: 'privateKey',
      publicKey: 'publicKey'
    })
  })

  beforeEach(async () => {
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = 'true'
    resetTrustProxyIpHeadersConfigCacheForTests()
    resetRouteRateLimitsForTests()
    if (holder.testDb) {
      await sql`DELETE FROM "rateLimit"`.execute(holder.testDb.db).catch(() => {
        // Table does not exist before the migration lands.
      })
    }
  })

  afterEach(() => {
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    resetTrustProxyIpHeadersConfigCacheForTests()
  })

  afterAll(async () => {
    await holder.testDb?.destroy()
  })

  const postAuth = async (
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
    options: { baseURL?: string; serviceName?: string } = {}
  ) => {
    const { getAuth } = await import('./auth')
    const baseURL = options.baseURL ?? BASE_URL
    const auth = options.serviceName
      ? getAuth(baseURL, options.serviceName)
      : getAuth(baseURL)
    return auth.handler(
      new Request(`${baseURL}/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseURL,
          ...headers
        },
        body: JSON.stringify(body)
      })
    )
  }

  const getAuthRoute = async (
    path: string,
    headers: Record<string, string> = {}
  ) => {
    const { getAuth } = await import('./auth')
    return getAuth(BASE_URL).handler(
      new Request(`${BASE_URL}/api/auth${path}`, {
        method: 'GET',
        headers: {
          origin: BASE_URL,
          ...headers
        }
      })
    )
  }

  it('answers 429 on /sign-in/email after 25 attempts from one IP while another IP still passes', async () => {
    for (let i = 0; i < SIGN_IN_PER_IP_LIMIT; i += 1) {
      const attempt = await postAuth(
        '/sign-in/email',
        { email: EMAIL, password: 'wrong-password' },
        { 'x-forwarded-for': '198.51.100.10' }
      )
      expect(attempt.status).toBe(401)
    }

    const throttled = await postAuth(
      '/sign-in/email',
      { email: EMAIL, password: PASSWORD },
      { 'x-forwarded-for': '198.51.100.10' }
    )
    expect(throttled.status).toBe(429)
    expect(Number(throttled.headers.get('X-Retry-After'))).toBeGreaterThan(0)

    // The per-email limit (tested on its own below) is also at its cap now.
    resetRouteRateLimitsForTests()
    const otherIp = await postAuth(
      '/sign-in/email',
      { email: EMAIL, password: PASSWORD },
      { 'x-forwarded-for': '198.51.100.11' }
    )
    expect(otherIp.status).toBe(200)
  })

  it('persists counters in the database so a second auth instance enforces the same limit', async () => {
    for (let i = 0; i < SIGN_IN_PER_IP_LIMIT; i += 1) {
      const attempt = await postAuth(
        '/sign-in/email',
        { email: EMAIL, password: 'wrong-password' },
        { 'x-forwarded-for': '198.51.100.12' },
        { baseURL: BASE_URL, serviceName: 'First Instance' }
      )
      expect(attempt.status).toBe(401)
    }

    const db = holder.testDb?.db
    if (!db) throw new Error('Test database not initialized')
    const stored = await sql<{ key: string; count: number }>`
      SELECT "key", "count" FROM "rateLimit" WHERE "key" = ${'198.51.100.12|/sign-in/email'}
    `.execute(db)
    expect(stored.rows).toEqual([
      { key: '198.51.100.12|/sign-in/email', count: SIGN_IN_PER_IP_LIMIT }
    ])

    // A separate auth instance (different baseURL and serviceName) reads the
    // shared database row and throttles the 6th attempt immediately.
    const secondInstanceAttempt = await postAuth(
      '/sign-in/email',
      { email: EMAIL, password: PASSWORD },
      { 'x-forwarded-for': '198.51.100.12' },
      { baseURL: SECOND_BASE_URL, serviceName: 'Second Instance' }
    )
    expect(secondInstanceAttempt.status).toBe(429)
  })

  it.each([
    {
      path: '/two-factor/verify-totp',
      body: { code: '000000' }
    },
    {
      path: '/two-factor/verify-backup-code',
      body: { code: 'invalid-backup' }
    },
    {
      path: '/two-factor/verify-otp',
      body: { code: '000000' }
    },
    {
      path: '/two-factor/send-otp',
      body: {}
    }
  ])('rate-limits $path after 25 requests per IP', async ({ path, body }) => {
    // Shares the sign-in per-IP numbers; the plugin's per-account lockout
    // (10 failures / 15 min) is what bounds guessing.
    for (let i = 0; i < SIGN_IN_PER_IP_LIMIT; i += 1) {
      const res = await postAuth(path, body, {
        'x-forwarded-for': '198.51.100.20'
      })
      expect(res.status).not.toBe(429)
    }

    const throttled = await postAuth(path, body, {
      'x-forwarded-for': '198.51.100.20'
    })
    expect(throttled.status).toBe(429)

    const otherIp = await postAuth(path, body, {
      'x-forwarded-for': '198.51.100.21'
    })
    expect(otherIp.status).not.toBe(429)
  })

  it.each([
    {
      method: 'POST' as const,
      path: '/request-password-reset',
      body: { email: EMAIL, redirectTo: `${BASE_URL}/auth/reset-password` }
    },
    {
      method: 'POST' as const,
      path: '/reset-password',
      body: { newPassword: 'new-password-12345', token: 'invalid-token' }
    },
    {
      method: 'GET' as const,
      path: '/reset-password/invalid-token',
      body: {}
    },
    {
      method: 'GET' as const,
      path: `/reset-password/invalid-token?callbackURL=${encodeURIComponent(`${BASE_URL}/auth/reset-password`)}`,
      body: {}
    },
    {
      method: 'POST' as const,
      path: '/send-verification-email',
      body: { email: EMAIL }
    },
    {
      method: 'POST' as const,
      path: '/verify-password',
      body: { password: PASSWORD }
    },
    {
      method: 'GET' as const,
      path: '/token',
      body: {}
    }
  ])(
    'answers 404 for disabled better-auth endpoint $method $path',
    async ({ method, path, body }) => {
      const res =
        method === 'GET'
          ? await getAuthRoute(path, { 'x-forwarded-for': '198.51.100.30' })
          : await postAuth(path, body, { 'x-forwarded-for': '198.51.100.30' })

      expect(res.status).toBe(404)

      const db = holder.testDb?.db
      if (!db) throw new Error('Test database not initialized')
      const rows = await sql<{ key: string }>`
        SELECT "key" FROM "rateLimit"
      `.execute(db)
      expect(rows.rows).toEqual([])
    }
  )

  it('does not create rateLimit rows for unknown /api/auth/* paths while still counting real endpoints', async () => {
    const ip = '198.51.100.50'
    for (let i = 0; i < 10; i += 1) {
      const unknownRoot = await getAuthRoute(`/unknown-route-${i}`, {
        'x-forwarded-for': ip
      })
      expect(unknownRoot.status).toBe(404)

      const unknownPluginSubpath = await postAuth(
        `/two-factor/unknown-${i}`,
        {},
        { 'x-forwarded-for': ip }
      )
      expect(unknownPluginSubpath.status).toBe(404)

      const unknownOAuthSubpath = await postAuth(
        `/oauth2/unknown-${i}`,
        {},
        { 'x-forwarded-for': ip }
      )
      expect(unknownOAuthSubpath.status).toBe(404)
    }

    const db = holder.testDb?.db
    if (!db) throw new Error('Test database not initialized')
    const afterUnknown = await sql<{ key: string; count: number }>`
      SELECT "key", "count" FROM "rateLimit"
    `.execute(db)
    expect(afterUnknown.rows).toEqual([])

    const realEndpoint = await getAuthRoute('/ok', { 'x-forwarded-for': ip })
    expect(realEndpoint.status).toBe(200)

    const afterReal = await sql<{ key: string; count: number }>`
      SELECT "key", "count" FROM "rateLimit"
    `.execute(db)
    expect(afterReal.rows).toEqual([{ key: `${ip}|/ok`, count: 1 }])

    // A parameterised endpoint (`/callback/:id`) is keyed by its concrete
    // pathname, so counting it would mint a row per `:id`; it is not counted.
    for (let i = 0; i < 3; i += 1) {
      await getAuthRoute(`/callback/provider-${i}`, { 'x-forwarded-for': ip })
    }
    const afterParameterised = await sql<{ key: string }>`
      SELECT "key" FROM "rateLimit" ORDER BY "key"
    `.execute(db)
    expect(afterParameterised.rows.map((row) => row.key)).toEqual([`${ip}|/ok`])
  })

  it('answers 429 on /sign-in/email after 25 attempts for one email without a trusted IP while another email passes', async () => {
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    resetTrustProxyIpHeadersConfigCacheForTests()

    for (let i = 0; i < SIGN_IN_EMAIL_LIMIT; i += 1) {
      // Case variants share the bucket.
      const email = i % 2 === 0 ? EMAIL : EMAIL.toUpperCase()
      const attempt = await postAuth('/sign-in/email', {
        email,
        password: 'wrong-password'
      })
      expect(attempt.status).toBe(401)
    }

    const throttled = await postAuth('/sign-in/email', {
      email: EMAIL,
      password: PASSWORD
    })
    expect(throttled.status).toBe(429)
    expect(await throttled.json()).toEqual({
      message: 'Too many requests. Please try again later.'
    })
    expect(Number(throttled.headers.get('X-Retry-After'))).toBeGreaterThan(0)
    expect(Number(throttled.headers.get('Retry-After'))).toBeGreaterThan(0)

    const otherEmail = await postAuth('/sign-in/email', {
      email: 'someone-else@example.com',
      password: 'wrong-password'
    })
    expect(otherEmail.status).toBe(401)

    const db = holder.testDb?.db
    if (!db) throw new Error('Test database not initialized')
    const rows = await sql<{
      key: string
    }>`SELECT "key" FROM "rateLimit"`.execute(db)
    expect(rows.rows).toEqual([])
  })

  it('preserves special plugin rate limits (two-factor 3/10s and oauth2/token 20/60s)', async () => {
    for (let i = 0; i < 3; i += 1) {
      const attempt = await postAuth(
        '/two-factor/enable',
        { password: PASSWORD },
        { 'x-forwarded-for': '198.51.100.51' }
      )
      expect(attempt.status).not.toBe(429)
    }
    const twoFactorThrottled = await postAuth(
      '/two-factor/enable',
      { password: PASSWORD },
      { 'x-forwarded-for': '198.51.100.51' }
    )
    expect(twoFactorThrottled.status).toBe(429)

    for (let i = 0; i < 20; i += 1) {
      const attempt = await postAuth(
        '/oauth2/token',
        { grant_type: 'client_credentials' },
        { 'x-forwarded-for': '198.51.100.52' }
      )
      expect(attempt.status).not.toBe(429)
    }
    const oauthTokenThrottled = await postAuth(
      '/oauth2/token',
      { grant_type: 'client_credentials' },
      { 'x-forwarded-for': '198.51.100.52' }
    )
    expect(oauthTokenThrottled.status).toBe(429)
  })

  it('leaves an over-long sign-in email to better-auth instead of counting it', async () => {
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    resetTrustProxyIpHeadersConfigCacheForTests()
    const tooLong = `${'a'.repeat(250)}@example.com`

    for (let i = 0; i <= SIGN_IN_EMAIL_LIMIT; i += 1) {
      const attempt = await postAuth('/sign-in/email', {
        email: tooLong,
        password: 'wrong-password'
      })
      expect(attempt.status).not.toBe(429)
    }
  })

  it('does not let X-Forwarded-For or internal-header spoofing reset the limit behind a trusted proxy header', async () => {
    for (let i = 0; i < SIGN_IN_PER_IP_LIMIT; i += 1) {
      const attempt = await postAuth(
        '/sign-in/email',
        { email: EMAIL, password: 'wrong-password' },
        {
          'cf-connecting-ip': '198.51.100.40',
          'x-forwarded-for': `203.0.113.${i + 1}`,
          'x-activities-trusted-client-ip': `192.0.2.${i + 1}`
        }
      )
      expect(attempt.status).toBe(401)
    }

    const spoofed = await postAuth(
      '/sign-in/email',
      { email: EMAIL, password: PASSWORD },
      {
        'cf-connecting-ip': '198.51.100.40',
        'x-forwarded-for': '203.0.113.99',
        'x-activities-trusted-client-ip': '192.0.2.99'
      }
    )
    expect(spoofed.status).toBe(429)

    // Multi-hop X-Forwarded-For uses the leftmost hop (matching getTrustedClientIp).
    resetRouteRateLimitsForTests()
    for (let i = 0; i < SIGN_IN_PER_IP_LIMIT; i += 1) {
      const attempt = await postAuth(
        '/sign-in/email',
        { email: EMAIL, password: 'wrong-password' },
        { 'x-forwarded-for': '198.51.100.41, 10.0.0.1' }
      )
      expect(attempt.status).toBe(401)
    }
    const multiHopLimited = await postAuth(
      '/sign-in/email',
      { email: EMAIL, password: PASSWORD },
      { 'x-forwarded-for': '198.51.100.41, 10.0.0.2' }
    )
    expect(multiHopLimited.status).toBe(429)
  })

  it('does not collapse callers without a trusted IP into a shared lockout bucket', async () => {
    // 1. Proxy IP headers untrusted (default): spoofed X-Forwarded-For is ignored
    // and callers do not share a 5-attempt lockout bucket.
    delete process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS
    resetTrustProxyIpHeadersConfigCacheForTests()

    for (let i = 0; i < 6; i += 1) {
      const attempt = await postAuth(
        '/sign-in/email',
        { email: EMAIL, password: 'wrong-password' },
        { 'x-forwarded-for': '203.0.113.77' }
      )
      expect(attempt.status).toBe(401)
    }

    // 2. Proxy IP headers trusted, but a request arrives with no IP header at all:
    // still does not populate a shared `no-trusted-ip` bucket.
    process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS = 'true'
    resetTrustProxyIpHeadersConfigCacheForTests()

    for (let i = 0; i < 6; i += 1) {
      const attempt = await postAuth('/sign-in/email', {
        email: EMAIL,
        password: 'wrong-password'
      })
      expect(attempt.status).toBe(401)
    }

    const validSignIn = await postAuth('/sign-in/email', {
      email: EMAIL,
      password: PASSWORD
    })
    expect(validSignIn.status).toBe(200)

    const db = holder.testDb?.db
    if (!db) throw new Error('Test database not initialized')
    const sharedBucketRows = await sql<{ key: string }>`
      SELECT "key" FROM "rateLimit" WHERE "key" LIKE 'no-trusted-ip|%' OR "key" LIKE '127.0.0.1|%'
    `.execute(db)
    expect(sharedBucketRows.rows).toEqual([])
  })
})
