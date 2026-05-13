import { NextRequest } from 'next/server'

import { proxy } from './proxy'

describe('proxy', () => {
  const previousActivitiesHost = process.env.ACTIVITIES_HOST
  const previousAllowActorDomains = process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
  const previousTrustedHosts = process.env.ACTIVITIES_TRUSTED_HOSTS

  beforeEach(() => {
    process.env.ACTIVITIES_HOST = 'public.example.com'
    delete process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
    delete process.env.ACTIVITIES_TRUSTED_HOSTS
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

  it('uses trusted forwarded host without loading Node-only config', async () => {
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
})
