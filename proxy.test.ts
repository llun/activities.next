import fs from 'fs'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'

import { resetHostConfigCacheForTests } from '@/lib/config/host'

import { proxy } from './proxy'

describe('proxy', () => {
  const previousActivitiesHost = process.env.ACTIVITIES_HOST
  const previousAllowActorDomains = process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
  const previousTrustedHosts = process.env.ACTIVITIES_TRUSTED_HOSTS
  const previousCwd = process.cwd()
  let testCwd: string

  beforeEach(() => {
    resetHostConfigCacheForTests()
    testCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-proxy-'))
    process.chdir(testCwd)
    process.env.ACTIVITIES_HOST = 'public.example.com'
    delete process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
    delete process.env.ACTIVITIES_TRUSTED_HOSTS
  })

  afterEach(() => {
    process.chdir(previousCwd)
    fs.rmSync(testCwd, { force: true, recursive: true })
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

  it('uses runtime config file for actor redirect host trust', async () => {
    delete process.env.ACTIVITIES_HOST
    fs.writeFileSync(
      path.join(testCwd, 'config.json'),
      JSON.stringify({
        host: 'runtime-public.example.com',
        allowActorDomains: ['runtime-actor.example.com'],
        trustedHosts: ['runtime-edge.example.com']
      })
    )

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

  it('uses runtime config file actor domains for actor redirect host trust', async () => {
    delete process.env.ACTIVITIES_HOST
    fs.writeFileSync(
      path.join(testCwd, 'config.json'),
      JSON.stringify({
        host: 'runtime-public.example.com',
        allowActorDomains: ['runtime-actor.example.com']
      })
    )

    const request = new NextRequest('https://internal.example.com/@alice', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'runtime-actor.example.com'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@runtime-actor.example.com'
    )
  })

  it('falls back to runtime config file host when forwarded host is untrusted', async () => {
    delete process.env.ACTIVITIES_HOST
    fs.writeFileSync(
      path.join(testCwd, 'config.json'),
      JSON.stringify({
        host: 'runtime-public.example.com',
        trustedHosts: ['runtime-edge.example.com']
      })
    )

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

  it('prefers runtime file config over runtime environment config', async () => {
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'env-edge.example.com'
    ])
    fs.writeFileSync(
      path.join(testCwd, 'config.json'),
      JSON.stringify({
        host: 'file-public.example.com',
        trustedHosts: ['file-edge.example.com']
      })
    )

    const request = new NextRequest('https://internal.example.com/@alice', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'env-edge.example.com'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@file-public.example.com'
    )
  })

  it('reuses runtime config file values after the first proxy request', async () => {
    delete process.env.ACTIVITIES_HOST
    fs.writeFileSync(
      path.join(testCwd, 'config.json'),
      JSON.stringify({
        host: 'runtime-public.example.com',
        trustedHosts: ['runtime-edge.example.com']
      })
    )

    const firstRequest = new NextRequest(
      'https://internal.example.com/@alice',
      {
        method: 'GET',
        headers: {
          host: 'internal.example.com',
          'x-forwarded-host': 'evil.example.com'
        }
      }
    )

    await proxy(firstRequest)

    fs.writeFileSync(
      path.join(testCwd, 'config.json'),
      JSON.stringify({
        host: 'changed-public.example.com',
        trustedHosts: ['changed-edge.example.com']
      })
    )

    const secondRequest = new NextRequest('https://internal.example.com/@bob', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'changed-edge.example.com'
      }
    })

    const response = await proxy(secondRequest)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@bob@runtime-public.example.com'
    )
  })

  it('uses trusted forwarded host when the proxy includes a port', async () => {
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'edge-public.example.com'
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
      'https://internal.example.com/@alice@edge-public.example.com'
    )
  })
})
