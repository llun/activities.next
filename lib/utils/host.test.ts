import {
  HostHeaders,
  getHostCacheSizesForTests,
  isHostTrustedByRules,
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
