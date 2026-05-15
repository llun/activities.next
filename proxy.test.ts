import { NextRequest } from 'next/server'

import { resetHostConfigCacheForTests } from '@/lib/config/host'

import { proxy } from './proxy'

const getCspDirectiveSources = (
  csp: string | null,
  directiveName: string
): string[] => {
  const directive = csp
    ?.split('; ')
    .find((value) => value.startsWith(`${directiveName} `))

  return directive?.split(/\s+/).slice(1) ?? []
}

describe('proxy', () => {
  const previousActivitiesHost = process.env.ACTIVITIES_HOST
  const previousAllowActorDomains = process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
  const previousMediaStorageBucket = process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET
  const previousMediaStorageHostname =
    process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
  const previousMediaStorageRegion = process.env.ACTIVITIES_MEDIA_STORAGE_REGION
  const previousMediaStorageType = process.env.ACTIVITIES_MEDIA_STORAGE_TYPE
  const previousProxyHostConfig = process.env.ACTIVITIES_PROXY_HOST_CONFIG
  const previousTrustedHosts = process.env.ACTIVITIES_TRUSTED_HOSTS

  beforeEach(() => {
    resetHostConfigCacheForTests()
    process.env.ACTIVITIES_HOST = 'public.example.com'
    delete process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
    delete process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET
    delete process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
    delete process.env.ACTIVITIES_MEDIA_STORAGE_REGION
    delete process.env.ACTIVITIES_MEDIA_STORAGE_TYPE
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

    if (previousMediaStorageBucket === undefined) {
      delete process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET
    } else {
      process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = previousMediaStorageBucket
    }

    if (previousMediaStorageHostname === undefined) {
      delete process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
    } else {
      process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME =
        previousMediaStorageHostname
    }

    if (previousMediaStorageRegion === undefined) {
      delete process.env.ACTIVITIES_MEDIA_STORAGE_REGION
    } else {
      process.env.ACTIVITIES_MEDIA_STORAGE_REGION = previousMediaStorageRegion
    }

    if (previousMediaStorageType === undefined) {
      delete process.env.ACTIVITIES_MEDIA_STORAGE_TYPE
    } else {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = previousMediaStorageType
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
        'x-forwarded-host': 'build-edge.example.com'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@runtime-public.example.com'
    )
  })

  it('uses injected proxy host config when runtime host config is absent', async () => {
    delete process.env.ACTIVITIES_HOST
    process.env.ACTIVITIES_PROXY_HOST_CONFIG = JSON.stringify({
      host: 'build-public.example.com',
      trustedHosts: ['build-edge.example.com']
    })

    const request = new NextRequest('https://internal.example.com/@alice', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'build-edge.example.com'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@build-edge.example.com'
    )
  })

  it('sets CSP from runtime media storage environment on ordinary app requests', async () => {
    process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 's3'
    process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = 'static.llun.social'
    process.env.ACTIVITIES_MEDIA_STORAGE_REGION = 'eu-central-1'

    const request = new NextRequest('https://llun.social/', {
      method: 'GET'
    })

    const response = await proxy(request)
    const connectSources = getCspDirectiveSources(
      response?.headers.get('Content-Security-Policy') ?? null,
      'connect-src'
    )

    expect(connectSources).toEqual(
      expect.arrayContaining([
        "'self'",
        'https://static.llun.social.s3.eu-central-1.amazonaws.com',
        'https://s3.eu-central-1.amazonaws.com'
      ])
    )
  })
})
