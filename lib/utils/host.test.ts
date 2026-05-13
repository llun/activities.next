import {
  getHostCacheSizesForTests,
  isHostTrustedByRules,
  normalizeHost,
  resetHostCachesForTests
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
