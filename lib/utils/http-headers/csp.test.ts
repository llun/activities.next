import { resetHostConfigCacheForTests } from '@/lib/config/host'

import {
  getContentSecurityPolicy,
  getEmbedContentSecurityPolicy,
  resetContentSecurityPolicyCacheForTests
} from './csp'

// getContentSecurityPolicy and getProxyHostConfig each memoize, so a test that
// changes ACTIVITIES_HOST must clear BOTH caches to observe the effect.
const getDirectiveSources = (name: string) =>
  getContentSecurityPolicy()
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `))
    ?.split(/\s+/)
    .slice(1) ?? []

const getImageSources = () => getDirectiveSources('img-src')

describe('getContentSecurityPolicy img-src app origin', () => {
  const originalHost = process.env.ACTIVITIES_HOST

  beforeEach(() => {
    resetHostConfigCacheForTests()
    resetContentSecurityPolicyCacheForTests()
  })

  afterEach(() => {
    if (originalHost === undefined) delete process.env.ACTIVITIES_HOST
    else process.env.ACTIVITIES_HOST = originalHost
    resetHostConfigCacheForTests()
    resetContentSecurityPolicyCacheForTests()
  })

  it('allows the canonical app origin (https-normalized) for the absolute logo URL', () => {
    process.env.ACTIVITIES_HOST = 'app.example.com'
    resetHostConfigCacheForTests()
    resetContentSecurityPolicyCacheForTests()

    expect(getImageSources()).toContain('https://app.example.com')
  })

  it('omits the app origin when ACTIVITIES_HOST is unset', () => {
    delete process.env.ACTIVITIES_HOST
    resetHostConfigCacheForTests()
    resetContentSecurityPolicyCacheForTests()

    const imageSources = getImageSources()
    expect(imageSources).toContain("'self'")
    // The empty host yields no app-origin source (getCspSource('') === null), so
    // the host that the first test injects must not appear here.
    expect(imageSources).not.toContain('https://app.example.com')
  })
})

describe('getContentSecurityPolicy map providers', () => {
  const MAP_PROVIDER_ENV_KEYS = [
    'ACTIVITIES_FITNESS_MAP_PROVIDER',
    'ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN',
    'ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID',
    'ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID',
    'ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY'
  ] as const
  const originalEnv = Object.fromEntries(
    MAP_PROVIDER_ENV_KEYS.map((key) => [key, process.env[key]])
  )

  const clearMapProviderEnv = () => {
    for (const key of MAP_PROVIDER_ENV_KEYS) delete process.env[key]
  }

  beforeEach(() => {
    clearMapProviderEnv()
    resetContentSecurityPolicyCacheForTests()
  })

  afterEach(() => {
    clearMapProviderEnv()
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) process.env[key] = value
    }
    resetContentSecurityPolicyCacheForTests()
  })

  const getEmbedDirectiveSources = (name: string) =>
    getEmbedContentSecurityPolicy()
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith(`${name} `))
      ?.split(/\s+/)
      .slice(1) ?? []

  it('allows the keyless MapLibre + OpenFreeMap sources when no Mapbox token is set', () => {
    resetContentSecurityPolicyCacheForTests()

    expect(getDirectiveSources('script-src')).toContain(
      'https://cdn.jsdelivr.net'
    )
    expect(getDirectiveSources('style-src')).toContain(
      'https://cdn.jsdelivr.net'
    )
    expect(getDirectiveSources('connect-src')).toContain(
      'https://tiles.openfreemap.org'
    )
    expect(getDirectiveSources('img-src')).toContain(
      'https://tiles.openfreemap.org'
    )
    // The Mapbox origins stay out of the policy when no token is configured.
    expect(getDirectiveSources('connect-src')).not.toContain(
      'https://api.mapbox.com'
    )
  })

  it('allows Mapbox (and not the free-map fallback) when a public token is set', () => {
    process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = 'pk.test-token'
    resetContentSecurityPolicyCacheForTests()

    expect(getDirectiveSources('script-src')).toContain(
      'https://api.mapbox.com'
    )
    expect(getDirectiveSources('connect-src')).toContain(
      'https://api.mapbox.com'
    )
    // The keyless fallback origins are omitted once Mapbox is configured.
    expect(getDirectiveSources('script-src')).not.toContain(
      'https://cdn.jsdelivr.net'
    )
    expect(getDirectiveSources('connect-src')).not.toContain(
      'https://tiles.openfreemap.org'
    )
  })

  it('falls back to the keyless free-map sources for a server-only Mapbox token', () => {
    process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = 'sk.secret-token'
    resetContentSecurityPolicyCacheForTests()

    expect(getDirectiveSources('script-src')).toContain(
      'https://cdn.jsdelivr.net'
    )
    expect(getDirectiveSources('connect-src')).toContain(
      'https://tiles.openfreemap.org'
    )
    expect(getContentSecurityPolicy()).not.toContain('mapbox.com')
  })

  it('allows the Apple MapKit JS sources in both the app and embed policies when Apple is configured', () => {
    process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'apple'
    process.env.ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID = 'TEAM123456'
    process.env.ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID = 'KEY1234567'
    process.env.ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----'
    resetContentSecurityPolicyCacheForTests()

    for (const getSources of [getDirectiveSources, getEmbedDirectiveSources]) {
      expect(getSources('script-src')).toEqual(
        expect.arrayContaining([
          'https://cdn.apple-mapkit.com',
          "'wasm-unsafe-eval'"
        ])
      )
      expect(getSources('style-src')).toContain('https://cdn.apple-mapkit.com')
      expect(getSources('connect-src')).toContain('https://*.apple-mapkit.com')
      expect(getSources('img-src')).toContain('https://*.apple-mapkit.com')
      expect(getSources('worker-src')).toEqual([
        "'self'",
        'blob:',
        'https://*.apple-mapkit.com'
      ])
      // The other providers' origins stay out of the policy.
      expect(getSources('script-src')).not.toContain('https://cdn.jsdelivr.net')
      expect(getSources('connect-src')).not.toContain('https://api.mapbox.com')
    }

    expect(getContentSecurityPolicy()).not.toContain('frame-src')
    expect(getContentSecurityPolicy()).not.toContain('child-src')
  })
})

describe('getContentSecurityPolicy frame-ancestors', () => {
  beforeEach(() => {
    resetContentSecurityPolicyCacheForTests()
  })

  afterEach(() => {
    resetContentSecurityPolicyCacheForTests()
  })

  const getFrameAncestors = (policy: string) =>
    policy
      .split(';')
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith('frame-ancestors '))
      ?.split(/\s+/)
      .slice(1) ?? []

  it("denies framing for the app policy (frame-ancestors 'none')", () => {
    expect(getFrameAncestors(getContentSecurityPolicy())).toEqual(["'none'"])
  })

  it('allows any embedder for the embed policy (frame-ancestors *)', () => {
    expect(getFrameAncestors(getEmbedContentSecurityPolicy())).toEqual(['*'])
  })

  it('only differs from the app policy in frame-ancestors', () => {
    const app = getContentSecurityPolicy().replace(
      "frame-ancestors 'none'",
      'frame-ancestors *'
    )
    expect(getEmbedContentSecurityPolicy()).toBe(app)
  })
})
