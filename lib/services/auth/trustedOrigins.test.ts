import { buildTrustedOrigins } from './trustedOrigins'

describe('buildTrustedOrigins', () => {
  // better-auth routes any pattern containing `*` through `wildcardMatch`, so
  // a misplaced wildcard is a GLOB rather than an inert literal:
  // `https://*example.com` would trust `https://evilexample.com`, and
  // `isTrustedOrigin` gates `callbackURL`/`redirectTo` as well as the Origin
  // check on state-changing auth requests.
  it.each([
    { description: 'a wildcard missing its dot', host: '*example.com' },
    { description: 'a trailing wildcard label', host: 'cdn.*' },
    { description: 'a wildcard in the middle', host: 'foo.*.example.com' },
    {
      description: 'a wildcard behind a scheme',
      host: 'https://*evil.example'
    },
    // The parser is what MAKES the `*` in these: it percent-decodes the
    // authority and applies IDNA mapping, so a pre-parse check sees no
    // wildcard at all and better-auth still globs the result.
    { description: 'a percent-encoded asterisk', host: '%2aexample.com' },
    { description: 'an upper-case percent escape', host: '%2Aexample.com' },
    {
      description: 'an encoded asterisk behind userinfo',
      host: 'user@%2aevil.example'
    },
    { description: 'a fullwidth asterisk', host: '＊example.com' },
    { description: 'a small asterisk', host: '﹡example.com' },
    {
      description: 'an encoded asterisk behind a scheme',
      host: 'https://%2Aexample.com'
    },
    // `blob:` derives its origin from the inner URL in its PATH and reports an
    // empty host, so the wildcard is invisible to a `hostname` check while
    // still reaching `origin` — the one scheme where the two disagree.
    {
      description: 'a blob URL hiding the wildcard in its path',
      host: 'blob:https://*evil.example/x'
    },
    {
      description: 'an upper-case blob scheme',
      host: 'BLOB:https://%2aevil.example/x'
    },
    {
      description: 'a blob URL with a fullwidth asterisk',
      host: 'blob:https://＊evil.example/x'
    }
  ])('drops $description', ({ host }) => {
    expect(
      buildTrustedOrigins('https://llun.test', [host, 'plain.example'])
    ).toEqual(['https://llun.test', 'https://plain.example'])
  })

  it.each([
    { description: 'bare', host: '*.good.example' },
    { description: 'behind a scheme', host: 'https://*.good.example' }
  ])('keeps the documented wildcard form $description', ({ host }) => {
    expect(buildTrustedOrigins('https://llun.test', [host])).toContain(
      'https://*.good.example'
    )
  })

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
