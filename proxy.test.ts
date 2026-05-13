import { NextRequest } from 'next/server'

import { resetHostConfigCacheForTests } from '@/lib/config/host'

import { proxy } from './proxy'

describe('proxy', () => {
  const previousActivitiesHost = process.env.ACTIVITIES_HOST
  const previousAllowActorDomains = process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
  const previousProxyHostConfig = process.env.ACTIVITIES_PROXY_HOST_CONFIG
  const previousTrustedHosts = process.env.ACTIVITIES_TRUSTED_HOSTS

  beforeEach(() => {
    resetHostConfigCacheForTests()
    process.env.ACTIVITIES_HOST = 'public.example.com'
    delete process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
    delete process.env.ACTIVITIES_PROXY_HOST_CONFIG
    delete process.env.ACTIVITIES_TRUSTED_HOSTS
  })

  afterEach(() => {
    resetHostConfigCacheForTests()
  })

  afterAll(() => {
    if (previousActivitiesHost === undefined) {
      delete process.env.ACTIVITIES_HOST
    } else {
      process.env.ACTIVITIES_HOST = previousActivitiesHost
    }

    if (previousAllowActorDomains === undefined) {
      delete process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
    } else {
      process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS = previousAllowActorDomains
    }

    if (previousProxyHostConfig === undefined) {
      delete process.env.ACTIVITIES_PROXY_HOST_CONFIG
    } else {
      process.env.ACTIVITIES_PROXY_HOST_CONFIG = previousProxyHostConfig
    }

    if (previousTrustedHosts === undefined) {
      delete process.env.ACTIVITIES_TRUSTED_HOSTS
    } else {
      process.env.ACTIVITIES_TRUSTED_HOSTS = previousTrustedHosts
    }
  })

  it('uses configured public host when X-Forwarded-Host would poison actor redirects', async () => {
    const request = new NextRequest('https://internal.example.com/@alice', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'evil.example.com'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@public.example.com'
    )
  })

  it('uses trusted forwarded host from environment config', async () => {
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'edge-public.example.com'
    ])

    const request = new NextRequest('https://internal.example.com/@alice', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'edge-public.example.com'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@edge-public.example.com'
    )
  })

  it('uses trusted forwarded host when the proxy includes a port', async () => {
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'edge-public.example.com:443'
    ])

    const request = new NextRequest('https://internal.example.com/@alice', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'edge-public.example.com:443'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@edge-public.example.com:443'
    )
  })

  it('uses runtime host config instead of stale injected proxy config', async () => {
    process.env.ACTIVITIES_HOST = 'runtime-public.example.com'
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'runtime-edge.example.com'
    ])
    process.env.ACTIVITIES_PROXY_HOST_CONFIG = JSON.stringify({
      host: 'build-public.example.com',
      trustedHosts: ['build-edge.example.com']
    })

    const request = new NextRequest('https://internal.example.com/@alice', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'runtime-edge.example.com'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@runtime-edge.example.com'
    )
  })

  it('falls back to runtime host when stale injected proxy config is present', async () => {
    process.env.ACTIVITIES_HOST = 'runtime-public.example.com'
    process.env.ACTIVITIES_PROXY_HOST_CONFIG = JSON.stringify({
      host: 'build-public.example.com',
      trustedHosts: ['build-edge.example.com']
    })

    const request = new NextRequest('https://internal.example.com/@alice', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'evil.example.com'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@runtime-public.example.com'
    )
  })
})
