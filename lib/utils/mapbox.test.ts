import { getPublicMapboxAccessToken } from '@/lib/utils/mapbox'

describe('getPublicMapboxAccessToken', () => {
  it('returns trimmed public Mapbox tokens for browser use', () => {
    expect(getPublicMapboxAccessToken(' pk.test-token ')).toBe('pk.test-token')
  })

  it('does not expose secret or empty Mapbox tokens to the browser', () => {
    expect(getPublicMapboxAccessToken('sk.secret-token')).toBeUndefined()
    expect(getPublicMapboxAccessToken('')).toBeUndefined()
    expect(getPublicMapboxAccessToken(undefined)).toBeUndefined()
  })
})
