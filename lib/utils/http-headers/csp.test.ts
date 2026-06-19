import { resetHostConfigCacheForTests } from '@/lib/config/host'

import {
  getContentSecurityPolicy,
  resetContentSecurityPolicyCacheForTests
} from './csp'

// getContentSecurityPolicy and getProxyHostConfig each memoize, so a test that
// changes ACTIVITIES_HOST must clear BOTH caches to observe the effect.
const getImageSources = () =>
  getContentSecurityPolicy()
    .split(';')
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith('img-src '))
    ?.split(/\s+/)
    .slice(1) ?? []

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
