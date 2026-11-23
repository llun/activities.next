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

  it('refuses a value that is not JSON, or a key without kid or private part', () => {
    process.env.ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS = 'not json'
    expect(() => getBlueskyConfig()).toThrow('must be JSON')

    process.env.ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS = JSON.stringify({
      ...key,
      kid: undefined
    })
    expect(() => getBlueskyConfig()).toThrow()

    process.env.ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS = JSON.stringify({
      ...key,
      d: undefined
    })
    expect(() => getBlueskyConfig()).toThrow()
  })
})
