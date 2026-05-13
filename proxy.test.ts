import fs from 'fs'
import { NextRequest } from 'next/server'
import path from 'path'

import { resetHostConfigCacheForTests } from '@/lib/config/host'

import { proxy } from './proxy'

describe('proxy', () => {
  const previousActivitiesHost = process.env.ACTIVITIES_HOST
  const previousAllowActorDomains = process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
  const previousTrustedHosts = process.env.ACTIVITIES_TRUSTED_HOSTS

  beforeEach(() => {
    resetHostConfigCacheForTests()
    process.env.ACTIVITIES_HOST = 'public.example.com'
    delete process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
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

  it('keeps using the environment host when config.json has no host', async () => {
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'edge-public.example.com'
    ])
    const configPath = path.resolve(process.cwd(), 'config.json')
    const previousConfig = fs.existsSync(configPath)
      ? fs.readFileSync(configPath, 'utf-8')
      : null
    fs.writeFileSync(
      configPath,
      JSON.stringify({ trustedHosts: ['edge-public.example.com'] })
    )

    try {
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
    } finally {
      if (previousConfig === null) {
        fs.unlinkSync(configPath)
      } else {
        fs.writeFileSync(configPath, previousConfig)
      }
    }
  })
})
