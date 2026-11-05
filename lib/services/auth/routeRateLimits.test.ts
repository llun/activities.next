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

  it('does not count an email longer than 254 characters', () => {
    const tooLong = `${'a'.repeat(250)}@example.com`
    for (let i = 0; i <= SIGN_IN_EMAIL_LIMIT; i += 1) {
      expect(checkSignInEmailRateLimit(tooLong)).toEqual({ allowed: true })
    }
  })
})
