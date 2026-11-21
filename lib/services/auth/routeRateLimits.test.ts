import { sql } from 'kysely'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'

import { getSQLDatabase } from '@/lib/database/getSQLDatabase'
import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'

import {
  APP_RATE_LIMIT_KEY_PREFIX,
  PASSWORD_CHANGE_LIMIT,
  SIGN_IN_EMAIL_LIMIT,
  checkPasswordChangeRateLimit,
  checkPasswordResetRateLimit,
  checkPasswordResetRequestRateLimit,
  checkSignInEmailRateLimit,
  checkSignUpRateLimit,
  resetRouteRateLimitsForTests,
  signInEmailRateLimitKey
} from './routeRateLimits'

const mockTrust = vi.fn(() => false)
const mockHeader = vi.fn((): string | null => null)
vi.mock('@/lib/config/trustProxyIpHeaders', () => ({
  getTrustProxyIpHeadersConfig: () => mockTrust(),
  getTrustProxyIpHeaderConfig: () => mockHeader()
}))

const holder = vi.hoisted(() => ({
  testDb: null as TestDatabase | null,
  database: null as Database | null
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => holder.database,
  getKysely: () => holder.testDb?.db
}))

const request = (headers: Record<string, string> = {}) =>
  new NextRequest('https://llun.test/api/v1/accounts', { headers })

describe('route rate limits', () => {
  const testDb = createTestDatabase()

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
    holder.testDb = testDb
    holder.database = testDb.database
  })

  beforeEach(async () => {
    mockTrust.mockReturnValue(false)
    mockHeader.mockReturnValue(null)
    holder.database = testDb.database
    await sql`DELETE FROM "rateLimit"`.execute(testDb.db)
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('keys on a SHA-256 digest of the normalised email, never the address', () => {
    const key = signInEmailRateLimitKey(' Person@Example.COM ')
    expect(key).toBe(
      createHash('sha256').update('person@example.com').digest('hex')
    )
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).not.toContain('example')
    expect(signInEmailRateLimitKey('person@example.com')).toBe(key)
  })

  it('counts every attempt per normalised email and refuses the 26th', async () => {
    for (let i = 0; i < SIGN_IN_EMAIL_LIMIT; i += 1) {
      expect(
        await checkSignInEmailRateLimit(
          i % 2 ? 'PERSON@example.com' : 'person@example.com'
        )
      ).toEqual({ allowed: true })
    }
    expect(await checkSignInEmailRateLimit('person@example.com')).toMatchObject(
      { allowed: false }
    )
    expect(await checkSignInEmailRateLimit('other@example.com')).toEqual({
      allowed: true
    })
  })

  it('counts a long email too, under its fixed-size digest', async () => {
    const long = `${'a'.repeat(250)}@example.com`
    for (let i = 0; i < SIGN_IN_EMAIL_LIMIT; i += 1) {
      expect(await checkSignInEmailRateLimit(long)).toEqual({ allowed: true })
    }
    expect((await checkSignInEmailRateLimit(long)).allowed).toBe(false)
  })

  it('stores only prefixed digests, never the email or IP', async () => {
    await checkSignInEmailRateLimit('person@example.com')
    mockTrust.mockReturnValue(true)
    mockHeader.mockReturnValue('x-forwarded-for')
    await checkSignUpRateLimit(request({ 'x-forwarded-for': '203.0.113.7' }))

    const rows = await testDb.db
      .selectFrom('rateLimit')
      .select(['key', 'count'])
      .orderBy('key')
      .execute()
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.key).toMatch(
        new RegExp(`^${APP_RATE_LIMIT_KEY_PREFIX}[a-z-]+:[0-9a-f]{64}$`)
      )
      expect(row.key).not.toContain('example')
      expect(row.key).not.toContain('203.0.113.7')
    }
  })

  it('shares one count between two independent service instances', async () => {
    const first = getSQLDatabase(testDb.db)
    const second = getSQLDatabase(testDb.db)

    holder.database = first
    for (let i = 0; i < SIGN_IN_EMAIL_LIMIT; i += 1) {
      expect(await checkSignInEmailRateLimit('shared@example.com')).toEqual({
        allowed: true
      })
    }

    holder.database = second
    expect(await checkSignInEmailRateLimit('shared@example.com')).toMatchObject(
      { allowed: false }
    )
  })

  it('applies per-IP buckets only behind a trusted proxy header', async () => {
    // No trusted header: the request is not counted, so it never trips.
    for (let i = 0; i < SIGN_IN_EMAIL_LIMIT + 5; i += 1) {
      expect(await checkSignUpRateLimit(request())).toEqual({ allowed: true })
    }
    expect(
      await testDb.db.selectFrom('rateLimit').select('key').execute()
    ).toEqual([])

    mockTrust.mockReturnValue(true)
    mockHeader.mockReturnValue('x-forwarded-for')
    for (let i = 0; i < 25; i += 1) {
      expect(
        await checkSignUpRateLimit(
          request({ 'x-forwarded-for': '203.0.113.8' })
        )
      ).toEqual({ allowed: true })
    }
    expect(
      await checkSignUpRateLimit(request({ 'x-forwarded-for': '203.0.113.8' }))
    ).toMatchObject({ allowed: false })
    // Another address has its own bucket.
    expect(
      await checkSignUpRateLimit(request({ 'x-forwarded-for': '203.0.113.9' }))
    ).toEqual({ allowed: true })
  })

  it('ignores a spoofed left-most X-Forwarded-For entry when the header is pinned', async () => {
    mockTrust.mockReturnValue(true)
    mockHeader.mockReturnValue('x-forwarded-for')

    for (let i = 0; i < 25; i += 1) {
      expect(
        await checkSignUpRateLimit(
          request({ 'x-forwarded-for': `198.51.100.${i + 1}, 203.0.113.10` })
        )
      ).toEqual({ allowed: true })
    }
    // The right-most hop is the real client, so the 26th attempt from it is
    // refused even though the client chose a fresh left-most entry.
    expect(
      await checkSignUpRateLimit(
        request({ 'x-forwarded-for': '198.51.100.99, 203.0.113.10' })
      )
    ).toMatchObject({ allowed: false })
  })

  it.each([
    { name: 'sign-up', check: checkSignUpRateLimit },
    {
      name: 'password reset request',
      check: checkPasswordResetRequestRateLimit
    },
    { name: 'password reset', check: checkPasswordResetRateLimit }
  ])(
    'rejects instead of throwing synchronously when the trusted-IP config is invalid ($name)',
    async ({ check }) => {
      mockTrust.mockReturnValue(true)
      mockHeader.mockImplementation(() => {
        throw new Error(
          'ACTIVITIES_TRUST_PROXY_IP_HEADER must be one of cf-connecting-ip, x-real-ip, x-forwarded-for, fly-client-ip, true-client-ip'
        )
      })

      // The call sites attach `.catch` to the returned promise; a synchronous
      // throw would escape before it and answer an unlogged 500.
      const caught = await check(request()).catch((error: unknown) => error)

      expect(caught).toBeInstanceOf(Error)
      expect((caught as Error).message).toContain(
        'ACTIVITIES_TRUST_PROXY_IP_HEADER'
      )
    }
  )

  it('resets its own rows without touching better-auth rows', async () => {
    await checkPasswordChangeRateLimit('account-1')
    await testDb.db
      .insertInto('rateLimit')
      .values({
        id: '203.0.113.1|/ok',
        key: '203.0.113.1|/ok',
        count: 1,
        lastRequest: Date.now()
      })
      .execute()

    await resetRouteRateLimitsForTests()

    const rows = await testDb.db.selectFrom('rateLimit').select('key').execute()
    expect(rows.map((row) => row.key)).toEqual(['203.0.113.1|/ok'])
  })

  it('keeps the password-change limit at 10 per account', async () => {
    for (let i = 0; i < PASSWORD_CHANGE_LIMIT; i += 1) {
      expect(await checkPasswordChangeRateLimit('account-2')).toEqual({
        allowed: true
      })
    }
    expect(await checkPasswordChangeRateLimit('account-2')).toMatchObject({
      allowed: false
    })
    expect(await checkPasswordChangeRateLimit('account-3')).toEqual({
      allowed: true
    })
  })
})
