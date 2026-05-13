import fs from 'fs'
import os from 'os'
import path from 'path'

import nextConfig, {
  getImageRemotePatterns,
  getSecurityHeaders
} from './next.config'

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
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      const headers = getSecurityHeaders()
      const csp = headers.find(
        (header) => header.key === 'Content-Security-Policy'
      )

      expect(csp?.value).toContain("default-src 'none'")
      expect(csp?.value).toContain("frame-ancestors 'none'")
      expect(csp?.value).toContain(
        "script-src 'self' 'unsafe-inline' https://api.mapbox.com"
      )
      expect(csp?.value).toContain(
        "style-src 'self' 'unsafe-inline' https://api.mapbox.com"
      )
      expect(csp?.value).toContain(
        "connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com"
      )
      expect(csp?.value).toContain("manifest-src 'self'")
      expect(csp?.value).not.toContain("'unsafe-eval'")
      expect(csp?.value).not.toContain('connect-src https:')
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
        value: 'camera=(), microphone=(), geolocation=(self)'
      })
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }
    }
  })

  it('allows development websocket connections for Next and HMR', () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'

    try {
      const csp = getSecurityHeaders().find(
        (header) => header.key === 'Content-Security-Policy'
      )

      expect(csp?.value).toContain(
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://api.mapbox.com"
      )
      expect(csp?.value).toContain(
        "connect-src 'self' https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com ws: wss:"
      )
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }
    }
  })

  it('disables next/image optimization for unbounded federated avatars', () => {
    expect(nextConfig.images?.unoptimized).toBe(true)
  })

  it('allows configured object storage connections without allowing all HTTPS', () => {
    const originalStorageHostname =
      process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
    process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = 'uploads.example.com'

    try {
      const csp = getSecurityHeaders().find(
        (header) => header.key === 'Content-Security-Policy'
      )

      expect(csp?.value).toContain('https://uploads.example.com')
      expect(csp?.value).not.toContain('connect-src https:')
    } finally {
      if (originalStorageHostname === undefined) {
        delete process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
      } else {
        process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = originalStorageHostname
      }
    }
  })

  it('allows local object storage connections in development', () => {
    const originalNodeEnv = process.env.NODE_ENV
    const originalStorageHostname =
      process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
    process.env.NODE_ENV = 'development'
    process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = 'http://localhost:9000'

    try {
      const csp = getSecurityHeaders().find(
        (header) => header.key === 'Content-Security-Policy'
      )

      expect(csp?.value).toContain('http://localhost:9000')
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }
      if (originalStorageHostname === undefined) {
        delete process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
      } else {
        process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = originalStorageHostname
      }
    }
  })

  it('allows default S3 presigned upload hosts in connect-src', () => {
    const originalStorageType = process.env.ACTIVITIES_MEDIA_STORAGE_TYPE
    const originalStorageBucket = process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET
    const originalStorageRegion = process.env.ACTIVITIES_MEDIA_STORAGE_REGION
    const originalStorageHostname =
      process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
    process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 's3'
    process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = 'media-bucket'
    process.env.ACTIVITIES_MEDIA_STORAGE_REGION = 'eu-west-1'
    delete process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME

    try {
      const csp = getSecurityHeaders().find(
        (header) => header.key === 'Content-Security-Policy'
      )

      expect(csp?.value).toContain(
        'https://media-bucket.s3.eu-west-1.amazonaws.com'
      )
      expect(csp?.value).toContain('https://s3.eu-west-1.amazonaws.com')
    } finally {
      if (originalStorageType === undefined) {
        delete process.env.ACTIVITIES_MEDIA_STORAGE_TYPE
      } else {
        process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = originalStorageType
      }
      if (originalStorageBucket === undefined) {
        delete process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET
      } else {
        process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = originalStorageBucket
      }
      if (originalStorageRegion === undefined) {
        delete process.env.ACTIVITIES_MEDIA_STORAGE_REGION
      } else {
        process.env.ACTIVITIES_MEDIA_STORAGE_REGION = originalStorageRegion
      }
      if (originalStorageHostname === undefined) {
        delete process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
      } else {
        process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = originalStorageHostname
      }
    }
  })

  it('uses the configured instance host and safe local hosts by default', () => {
    const originalAllowlist = process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS
    const originalHost = process.env.ACTIVITIES_HOST
    const originalNodeEnv = process.env.NODE_ENV
    delete process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS
    process.env.ACTIVITIES_HOST = 'social.example.com'
    process.env.NODE_ENV = 'development'

    try {
      expect(getImageRemotePatterns()).toEqual([
        {
          protocol: 'https',
          hostname: '**'
        },
        {
          protocol: 'http',
          hostname: 'localhost'
        },
        {
          protocol: 'http',
          hostname: '127.0.0.1'
        },
        {
          protocol: 'http',
          hostname: '[::1]'
        }
      ])
    } finally {
      if (originalAllowlist === undefined) {
        delete process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS
      } else {
        process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS = originalAllowlist
      }
      if (originalHost === undefined) {
        delete process.env.ACTIVITIES_HOST
      } else {
        process.env.ACTIVITIES_HOST = originalHost
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }
    }
  })

  it('treats an empty image host allowlist as default config', () => {
    const originalHost = process.env.ACTIVITIES_HOST
    const originalNodeEnv = process.env.NODE_ENV
    process.env.ACTIVITIES_HOST = 'social.example.com'
    process.env.NODE_ENV = 'production'

    try {
      expect(getImageRemotePatterns('')).toEqual([
        {
          protocol: 'https',
          hostname: '**'
        }
      ])
    } finally {
      if (originalHost === undefined) {
        delete process.env.ACTIVITIES_HOST
      } else {
        process.env.ACTIVITIES_HOST = originalHost
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
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
        hostname: '**'
      },
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
    const federatedAvatarPattern = {
      protocol: 'https',
      hostname: '**'
    }

    expect(getImageRemotePatterns(JSON.stringify(['**']))).toEqual([
      federatedAvatarPattern
    ])
    expect(getImageRemotePatterns(JSON.stringify(['*.example.com']))).toEqual([
      federatedAvatarPattern
    ])
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
