import fs from 'fs'
import os from 'os'
import path from 'path'

import { getImageRemotePatterns, getSecurityHeaders } from './next.config'

const loadNextConfig = async () => {
  jest.resetModules()
  return import('./next.config')
}

describe('getProxyHostConfigEnv', () => {
  const originalCwd = process.cwd()
  const previousActivitiesHost = process.env.ACTIVITIES_HOST
  const previousTrustedHosts = process.env.ACTIVITIES_TRUSTED_HOSTS

  let tempDirectory: string

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-next-'))
    process.chdir(tempDirectory)
    delete process.env.ACTIVITIES_HOST
    delete process.env.ACTIVITIES_TRUSTED_HOSTS
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDirectory, { force: true, recursive: true })
    jest.resetModules()

    if (previousActivitiesHost === undefined) {
      delete process.env.ACTIVITIES_HOST
    } else {
      process.env.ACTIVITIES_HOST = previousActivitiesHost
    }

    if (previousTrustedHosts === undefined) {
      delete process.env.ACTIVITIES_TRUSTED_HOSTS
    } else {
      process.env.ACTIVITIES_TRUSTED_HOSTS = previousTrustedHosts
    }
  })

  it('injects file-based proxy host config without actor domain allowlists', async () => {
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        host: 'file-public.example.com',
        allowActorDomains: ['external-actor.example.com'],
        trustedHosts: ['file-edge.example.com']
      })
    )

    const { getProxyHostConfigEnv } = await loadNextConfig()

    expect(
      JSON.parse(getProxyHostConfigEnv().ACTIVITIES_PROXY_HOST_CONFIG)
    ).toEqual({
      host: 'file-public.example.com',
      trustedHosts: ['file-edge.example.com']
    })
  })

  it('does not snapshot runtime environment proxy host config at build time', async () => {
    process.env.ACTIVITIES_HOST = 'env-public.example.com'
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'env-edge.example.com'
    ])

    const { default: nextConfig, getProxyHostConfigEnv } =
      await loadNextConfig()

    expect(getProxyHostConfigEnv()).toEqual({})
    expect(nextConfig.env).toBeUndefined()
  })
})

describe('next config security hardening', () => {
  it('sets baseline browser security headers', () => {
    const headers = getSecurityHeaders()
    const csp = headers.find(
      (header) => header.key === 'Content-Security-Policy'
    )

    expect(csp?.value).toContain("frame-ancestors 'none'")
    expect(csp?.value).not.toContain('script-src')
    expect(headers).toContainEqual({
      key: 'X-Content-Type-Options',
      value: 'nosniff'
    })
    expect(headers).toContainEqual({
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin'
    })
    expect(headers).toContainEqual({
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=()'
    })
  })

  it('allows HTTPS remote images by default for open federation', () => {
    const originalAllowlist = process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS
    delete process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS

    try {
      expect(getImageRemotePatterns()).toEqual([
        {
          protocol: 'https',
          hostname: '**'
        }
      ])
    } finally {
      if (originalAllowlist === undefined) {
        delete process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS
      } else {
        process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS = originalAllowlist
      }
    }
  })

  it('builds configured HTTPS image host patterns', () => {
    const patterns = getImageRemotePatterns(
      JSON.stringify(['media.example.com', 'https://cdn.example.com/Images'])
    )

    expect(patterns).toEqual([
      {
        protocol: 'https',
        hostname: 'media.example.com'
      },
      {
        protocol: 'https',
        hostname: 'cdn.example.com',
        pathname: '/Images/**'
      }
    ])
  })

  it('rejects wildcard image host configuration', () => {
    expect(getImageRemotePatterns(JSON.stringify(['**']))).toEqual([])
    expect(getImageRemotePatterns(JSON.stringify(['*.example.com']))).toEqual(
      []
    )
  })

  it('rejects malformed image host configuration', () => {
    expect(() => getImageRemotePatterns('{')).toThrow(
      'ACTIVITIES_ALLOW_MEDIA_DOMAINS must be a JSON array'
    )
  })

  it('rejects non-array image host configuration', () => {
    expect(() => getImageRemotePatterns(JSON.stringify({}))).toThrow(
      'ACTIVITIES_ALLOW_MEDIA_DOMAINS must be a JSON array'
    )
    expect(() => getImageRemotePatterns(JSON.stringify('example.com'))).toThrow(
      'ACTIVITIES_ALLOW_MEDIA_DOMAINS must be a JSON array'
    )
  })
})
