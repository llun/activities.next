import { buildTrustedOrigins } from './trustedOrigins'

describe('buildTrustedOrigins', () => {
  it('returns just the base origin when there are no trusted hosts', () => {
    expect(buildTrustedOrigins('https://activities.local')).toEqual([
      'https://activities.local'
    ])
  })

  it('adds trusted hosts using the base URL scheme', () => {
    expect(
      buildTrustedOrigins('https://activities.local', ['alias.local'])
    ).toEqual(['https://activities.local', 'https://alias.local'])
  })

  it('keeps an explicit scheme on a trusted host, preserves ports, and dedupes', () => {
    expect(
      buildTrustedOrigins('http://localhost:3000', [
        'alias.local:3000',
        'https://other.local',
        'localhost:3000'
      ])
    ).toEqual([
      'http://localhost:3000',
      'http://alias.local:3000',
      'https://other.local'
    ])
  })

  it('ignores blank entries', () => {
    expect(buildTrustedOrigins('https://activities.local', ['', '  '])).toEqual(
      ['https://activities.local']
    )
  })

  it('skips malformed host entries instead of throwing', () => {
    expect(
      buildTrustedOrigins('https://activities.local', [
        'alias.local',
        'http://[oops'
      ])
    ).toEqual(['https://activities.local', 'https://alias.local'])
  })
})
