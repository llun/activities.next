import {
  HostHeaders,
  getCanonicalAuthority,
  getHostCacheSizesForTests,
  isHostTrustedByRules,
  isOwnInstanceHost,
  normalizeHost,
  resetHostCachesForTests,
  selectHeaderHost
} from './host'

describe('isHostTrustedByRules', () => {
  afterEach(() => {
    resetHostCachesForTests()
  })

  it('matches a rule without a port when the host has no port or the default HTTPS port', () => {
    expect(
      isHostTrustedByRules('edge.example.com', ['edge.example.com'])
    ).toBeTrue()
    expect(
      isHostTrustedByRules('edge.example.com:443', ['edge.example.com'])
    ).toBeTrue()
    expect(
      isHostTrustedByRules('edge.example.com:8443', ['edge.example.com'])
    ).toBeFalse()
  })

  it('requires explicit ports to match exactly', () => {
    expect(
      isHostTrustedByRules('edge.example.com:8443', ['edge.example.com:8443'])
    ).toBeTrue()
    expect(
      isHostTrustedByRules('edge.example.com:9443', ['edge.example.com:8443'])
    ).toBeFalse()
    expect(
      isHostTrustedByRules('edge.example.com', ['edge.example.com:8443'])
    ).toBeFalse()
  })

  it('preserves explicit non-default port behavior for exact rule matching', () => {
    expect(normalizeHost('edge.example.com:443')).toBe('edge.example.com:443')
    expect(
      isHostTrustedByRules('edge.example.com:443', ['edge.example.com:443'])
    ).toBeTrue()
    expect(
      isHostTrustedByRules('edge.example.com', ['edge.example.com:443'])
    ).toBeTrue()
    expect(
      isHostTrustedByRules('edge.example.com', ['edge.example.com:8443'])
    ).toBeFalse()
  })

  it('applies port matching to wildcard rules', () => {
    expect(
      isHostTrustedByRules('media.edge.example.com', ['*.edge.example.com'])
    ).toBeTrue()
    expect(
      isHostTrustedByRules('media.edge.example.com:8443', [
        '*.edge.example.com'
      ])
    ).toBeFalse()
    expect(
      isHostTrustedByRules('media.edge.example.com:8443', [
        '*.edge.example.com:8443'
      ])
    ).toBeTrue()
  })

  it('normalizes bracketed IPv6 hosts without treating address segments as ports', () => {
    expect(normalizeHost('[2001:db8::1]')).toBe('[2001:db8::1]')
    expect(isHostTrustedByRules('[2001:db8::1]', ['[2001:db8::1]'])).toBeTrue()
  })

  it('normalizes bracketed IPv6 hosts with explicit ports', () => {
    expect(normalizeHost('[2001:db8::1]:8443')).toBe('[2001:db8::1]:8443')
    expect(
      isHostTrustedByRules('[2001:db8::1]:8443', ['[2001:db8::1]:8443'])
    ).toBeTrue()
    expect(
      isHostTrustedByRules('[2001:db8::1]', ['[2001:db8::1]:8443'])
    ).toBeFalse()
  })

  it('rejects local and socket-style host values', () => {
    expect(normalizeHost('localhost')).toBeNull()
    expect(normalizeHost('localhost:3000')).toBeNull()
    expect(normalizeHost('::1')).toBeNull()
    expect(normalizeHost('[::1]:3000')).toBeNull()
    expect(normalizeHost('/var/run/activities.sock')).toBeNull()
    expect(normalizeHost('unix:/var/run/activities.sock')).toBeNull()
  })

  it('rejects userinfo and non-host URL parts', () => {
    expect(normalizeHost('evil.example.com@edge.example.com')).toBeNull()
    expect(
      normalizeHost('https://evil.example.com@edge.example.com')
    ).toBeNull()
    expect(normalizeHost('edge.example.com/path')).toBeNull()
    expect(normalizeHost('edge.example.com?target=other')).toBeNull()
    expect(normalizeHost('edge.example.com#fragment')).toBeNull()
  })

  it('rejects wildcard values from incoming hosts while allowing wildcard rules', () => {
    expect(
      isHostTrustedByRules('tenant.edge.example.com', ['*.edge.example.com'])
    ).toBeTrue()
    expect(
      isHostTrustedByRules('*.edge.example.com', ['edge.example.com'])
    ).toBeFalse()
    expect(
      selectHeaderHost(new Headers({ 'x-forwarded-host': '*.example.com' }), {
        host: 'example.com',
        trustedHosts: ['example.com']
      })
    ).toBe('example.com')
  })

  it('does not trust forwarded hosts from actor domain allowlists', () => {
    expect(
      selectHeaderHost(
        new Headers({ 'x-forwarded-host': 'actor.example.com' }),
        {
          host: 'test.llun.dev',
          allowActorDomains: ['actor.example.com']
        } as Parameters<typeof selectHeaderHost>[1] & {
          allowActorDomains: string[]
        }
      )
    ).toBe('test.llun.dev')
  })

  it('uses direct record header lookups before scanning keys', () => {
    const headers = new Proxy(
      {
        'x-activity-next-host': 'test-custom.llun.dev'
      },
      {
        ownKeys: () => {
          throw new Error('unexpected key scan')
        }
      }
    ) as HostHeaders

    expect(
      selectHeaderHost(headers, {
        host: 'test.llun.dev',
        trustedHosts: ['test-custom.llun.dev']
      })
    ).toBe('test-custom.llun.dev')
  })

  it('bounds host parsing caches', () => {
    for (let index = 0; index < 1200; index += 1) {
      expect(
        isHostTrustedByRules(`tenant-${index}.edge.example.com`, [
          '*.edge.example.com'
        ])
      ).toBeTrue()
    }

    expect(getHostCacheSizesForTests().hostParts).toBeLessThanOrEqual(1024)
  })

  it('bounds normalized host rules cache entries', () => {
    for (let index = 0; index < 300; index += 1) {
      expect(
        isHostTrustedByRules(`tenant-${index}.edge.example.com`, [
          `tenant-${index}.edge.example.com`
        ])
      ).toBeTrue()
    }

    expect(getHostCacheSizesForTests().normalizedRules).toBeLessThanOrEqual(256)
  })
})

// `normalizeHost` governs BOTH sides of the wildcard pipeline — the rule list
// through `normalizeHostRules`, and the incoming header directly — so #1578's
// refusal has to be pinned at the inbound entry point too, not only through
// `isOwnInstanceHost`. A real subdomain must still be believed.
describe('selectHeaderHost wildcard rules', () => {
  afterEach(() => {
    resetHostCachesForTests()
  })

  it('still selects a wildcard-trusted subdomain from a forwarded host', () => {
    expect(
      selectHeaderHost(
        new Headers({ 'x-forwarded-host': 'cdn.edge.llun.test' }),
        { host: 'llun.test', trustedHosts: ['*.edge.llun.test'] }
      )
    ).toBe('cdn.edge.llun.test')
  })
})

describe('isOwnInstanceHost', () => {
  afterEach(() => {
    resetHostCachesForTests()
  })

  const config = {
    host: 'llun.test',
    trustedHosts: ['alias.example', '*.edge.llun.test']
  }

  it.each([
    { description: 'the configured host', host: 'llun.test', expected: true },
    {
      description: 'the configured host in another case',
      host: 'LLUN.TEST',
      expected: true
    },
    {
      description: 'a trusted host',
      host: 'alias.example',
      expected: true
    },
    {
      description: 'a wildcard trusted host',
      host: 'cdn.edge.llun.test',
      expected: true
    },
    // These three lead with the port: the reporter shows only the first 37
    // characters of `$description`, and spelled the other way round the first
    // two rendered as the same line.
    {
      description: 'port 443 on the configured host',
      host: 'llun.test:443',
      expected: true
    },
    {
      description: 'port 80 on the configured host',
      host: 'llun.test:80',
      expected: true
    },
    {
      description: 'port 8443 on the configured host',
      host: 'llun.test:8443',
      expected: false
    },
    {
      description: 'a host that only shares a suffix',
      host: 'evil-llun.test',
      expected: false
    },
    {
      description: 'an unrelated subdomain',
      host: 'sub.llun.test',
      expected: false
    },
    {
      description: 'an unrelated host',
      host: 'other.example',
      expected: false
    },
    { description: 'an empty host', host: '', expected: false },
    { description: 'a missing host', host: null, expected: false }
  ])('answers $expected for $description', ({ host, expected }) => {
    expect(isOwnInstanceHost(host, config)).toBe(expected)
  })

  // `normalizeHost` rejects loopback names so an inbound `X-Forwarded-Host`
  // can never claim one, which leaves `isHostTrustedByRules` unable to
  // recognise a development instance's own host. The exact-authority pass is
  // what covers it.
  it.each([
    { description: 'a loopback host with a port', host: 'localhost:3000' },
    { description: 'a loopback address', host: '127.0.0.1:3000' }
  ])('recognises $description as our own', ({ host }) => {
    expect(isOwnInstanceHost(host, { host })).toBeTrue()
    expect(isHostTrustedByRules(host, [host])).toBeFalse()
  })

  // `new URL()` accepts `*` in a host, so a rule compared literally against
  // itself would let a URL spelling that authority pass as ours — the hole
  // `scripts/maintenance/backfillMediaBlurhash.ts` documents closing for its
  // own matcher. Wildcards belong to the rules pass, which expands them.
  it.each([
    { description: 'the wildcard rule itself', host: '*.edge.llun.test' },
    {
      description: 'the wildcard rule in another case',
      host: '*.EDGE.llun.test'
    },
    { description: 'a bare wildcard label', host: '*' }
  ])('answers false for $description', ({ host }) => {
    expect(isOwnInstanceHost(host, config)).toBeFalse()
  })

  // Only `*.example.com` is a wildcard to `normalizeHost`. Every other
  // spelling used to survive as a literal hostname carrying a `*`, and
  // `new URL()` percent-decodes `%2a`, so a caller could spell that authority
  // exactly and be believed as one of ours.
  it.each([
    { description: 'a wildcard missing its dot', rule: '*llun.test' },
    { description: 'a wildcard in the middle', rule: 'foo.*.llun.test' },
    { description: 'a trailing wildcard label', rule: 'cdn.llun.test.*' },
    { description: 'a wildcard inside a label', rule: '*-cdn.llun.test' }
  ])('refuses an authority spelled as $description', ({ rule }) => {
    const spoofed = rule.replaceAll('*', '%2a')
    expect(normalizeHost(rule)).toBeNull()
    expect(
      isOwnInstanceHost(new URL(`https://${spoofed}`).host, {
        host: 'llun.test',
        trustedHosts: [rule]
      })
    ).toBeFalse()
  })

  // The marker sits on the authority, so it has to be found behind a scheme
  // too — refusing a stray `*` otherwise killed this spelling, which used to
  // work only because `getHostParts` re-read the literal the parse produced.
  it.each([
    {
      description: 'a bare wildcard rule',
      rule: '*.edge.llun.test',
      host: 'cdn.edge.llun.test'
    },
    {
      description: 'a wildcard rule behind a scheme',
      rule: 'https://*.edge.llun.test',
      host: 'cdn.edge.llun.test'
    },
    {
      description: 'a wildcard rule with a port',
      rule: '*.edge.llun.test:8443',
      host: 'cdn.edge.llun.test:8443'
    }
  ])('still expands $description', ({ rule, host }) => {
    expect(normalizeHost(rule)).not.toBeNull()
    expect(isHostTrustedByRules(host, [rule])).toBeTrue()
  })

  it('tolerates a configured host written as a URL', () => {
    expect(
      isOwnInstanceHost('llun.test', { host: 'https://llun.test/' })
    ).toBeTrue()
  })

  it('answers false when no host is configured', () => {
    expect(isOwnInstanceHost('llun.test', { host: '' })).toBeFalse()
    expect(isOwnInstanceHost('', { host: '' })).toBeFalse()
  })
})

// Moved here with `getCanonicalAuthority` itself, from the copy
// `scripts/maintenance/backfillMediaBlurhash.ts` kept to normalise the
// configured host before minting a media URL from it.
describe('getCanonicalAuthority', () => {
  it.each([
    {
      description: 'strips a scheme',
      value: 'https://llun.test',
      expected: 'llun.test'
    },
    {
      description: 'strips a trailing path',
      value: 'llun.test/',
      expected: 'llun.test'
    },
    {
      description: 'strips a query string',
      value: 'llun.test?x=1',
      expected: 'llun.test'
    },
    { description: 'lowercases', value: 'LLUN.test', expected: 'llun.test' },
    {
      description: 'drops an explicit https default port',
      value: 'llun.test:443',
      expected: 'llun.test'
    },
    {
      description: 'drops an explicit http default port',
      value: 'llun.test:80',
      expected: 'llun.test'
    },
    {
      description: 'keeps a non-default port',
      value: 'localhost:3000',
      expected: 'localhost:3000'
    },
    {
      description: 'trims surrounding space',
      value: '  llun.test  ',
      expected: 'llun.test'
    },
    {
      description: 'answers empty for an empty value',
      value: '',
      expected: ''
    },
    {
      description: 'answers empty for a missing value',
      value: null,
      expected: ''
    }
  ])('$description', ({ value, expected }) => {
    expect(getCanonicalAuthority(value)).toBe(expected)
  })
})
