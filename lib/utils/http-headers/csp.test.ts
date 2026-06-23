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
  const originalToken = process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN

  beforeEach(() => {
    resetContentSecurityPolicyCacheForTests()
  })

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN
    } else {
      process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = originalToken
    }
    resetContentSecurityPolicyCacheForTests()
  })

  it('allows the keyless MapLibre + OpenFreeMap sources when no Mapbox token is set', () => {
    delete process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN
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
