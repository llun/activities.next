import { createHash } from 'node:crypto'

import {
  SIGN_IN_EMAIL_LIMIT,
  checkSignInEmailRateLimit,
  resetRouteRateLimitsForTests,
  signInEmailRateLimitKey
} from './routeRateLimits'

vi.mock('@/lib/config/trustProxyIpHeaders', () => ({
  getTrustProxyIpHeadersConfig: () => false,
  getTrustProxyIpHeaderConfig: () => null
}))

describe('checkSignInEmailRateLimit', () => {
  beforeEach(() => {
    resetRouteRateLimitsForTests()
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

  it('keeps a guessed email limited through a flood of one-off emails, and still admits a new one', () => {
    for (let i = 0; i < SIGN_IN_EMAIL_LIMIT; i += 1) {
      checkSignInEmailRateLimit('target@example.com')
    }
    // More one-attempt keys than the map holds.
    for (let i = 0; i <= 100_000; i += 1) {
      checkSignInEmailRateLimit(`bot${i}@example.com`)
    }
    expect(checkSignInEmailRateLimit('target@example.com')).toMatchObject({
      allowed: false
    })
    expect(checkSignInEmailRateLimit('new-user@example.com')).toEqual({
      allowed: true
    })
  })

  it('counts every attempt per normalised email and refuses the 26th', () => {
    for (let i = 0; i < SIGN_IN_EMAIL_LIMIT; i += 1) {
      expect(
        checkSignInEmailRateLimit(
          i % 2 ? 'PERSON@example.com' : 'person@example.com'
        )
      ).toEqual({ allowed: true })
    }
    expect(checkSignInEmailRateLimit('person@example.com')).toMatchObject({
      allowed: false
    })
    expect(checkSignInEmailRateLimit('other@example.com')).toEqual({
      allowed: true
    })
  })

  it('counts a long email too, under its fixed-size digest', () => {
    const long = `${'a'.repeat(250)}@example.com`
    for (let i = 0; i < SIGN_IN_EMAIL_LIMIT; i += 1) {
      expect(checkSignInEmailRateLimit(long)).toEqual({ allowed: true })
    }
    expect(checkSignInEmailRateLimit(long).allowed).toBe(false)
  })
})
