import { getBlueskyConfig } from './bluesky'

describe('getBlueskyConfig', () => {
  const originalEnv = process.env
  const key = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd', kid: 'k1' }

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('is off when no keys are set', () => {
    expect(getBlueskyConfig()).toBeNull()
  })

  it('keeps only the EC key fields', () => {
    process.env.ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS = JSON.stringify({
      ...key,
      p: 'stray-private-part'
    })
    expect(getBlueskyConfig()?.bluesky.oauthPrivateKeys[0]).not.toHaveProperty(
      'p'
    )
  })

  it('takes one key or an array of keys', () => {
    process.env.ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS = JSON.stringify(key)
    expect(getBlueskyConfig()?.bluesky.oauthPrivateKeys).toEqual([key])

    process.env.ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS = JSON.stringify([
      key,
      { ...key, kid: 'k2' }
    ])
    expect(
      getBlueskyConfig()?.bluesky.oauthPrivateKeys.map((jwk) => jwk.kid)
    ).toEqual(['k1', 'k2'])
  })

  it('turns sign-in off for a value that is not JSON, or a key without kid or private part', () => {
    for (const value of [
      'not json',
      JSON.stringify({ ...key, kid: undefined }),
      JSON.stringify({ ...key, d: undefined }),
      // Only ES256 keys: the JWKS of any other kind could carry private parts.
      JSON.stringify({
        kty: 'RSA',
        n: 'n',
        e: 'AQAB',
        d: 'd',
        p: 'p',
        kid: 'r'
      }),
      JSON.stringify({ ...key, crv: 'secp256k1' }),
      JSON.stringify({ ...key, kty: 'OKP', crv: 'Ed25519' })
    ]) {
      process.env.ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS = value
      expect(getBlueskyConfig()).toBeNull()
    }
  })
})
