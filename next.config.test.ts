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

const withEnv = <T>(
  values: Record<string, string | undefined>,
  callback: () => T
): T => {
  const previousValues = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  )

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return callback()
  } finally {
    for (const [key, value] of Object.entries(previousValues)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

const getCspDirectiveSources = (directiveName: string) => {
  const csp = getSecurityHeaders().find(
    (header) => header.key === 'Content-Security-Policy'
  )
  const directive = csp?.value
    .split('; ')
    .find((value) => value.startsWith(`${directiveName} `))

  return directive?.split(/\s+/).slice(1) ?? []
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
    withEnv(
      {
        NODE_ENV: 'production',
        ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN: undefined
      },
      () => {
        const headers = getSecurityHeaders()
        const csp = headers.find(
          (header) => header.key === 'Content-Security-Policy'
        )
        const scriptSources = getCspDirectiveSources('script-src')
        const styleSources = getCspDirectiveSources('style-src')
        const connectSources = getCspDirectiveSources('connect-src')
        const mediaSources = getCspDirectiveSources('media-src')

        expect(csp?.value).toContain("default-src 'none'")
        expect(csp?.value).toContain("frame-ancestors 'none'")
        expect(scriptSources).toEqual(["'self'", "'unsafe-inline'"])
        expect(styleSources).toEqual(["'self'", "'unsafe-inline'"])
        expect(connectSources).toEqual(["'self'"])
        expect(csp?.value).toContain("manifest-src 'self'")
        expect(mediaSources).toEqual(["'self'", 'https:', 'blob:'])
        expect(csp?.value).not.toContain("'unsafe-eval'")
        expect(csp?.value).not.toContain('mapbox.com')
        expect(connectSources).not.toContain('https:')
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
      }
    )
  })

  it('allows development websocket connections for Next and HMR', () => {
    withEnv(
      {
        NODE_ENV: 'development',
        ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN: undefined
      },
      () => {
        const scriptSources = getCspDirectiveSources('script-src')
        const connectSources = getCspDirectiveSources('connect-src')

        expect(scriptSources).toEqual([
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'"
        ])
        expect(connectSources).toEqual(expect.arrayContaining(['ws:', 'wss:']))
      }
    )
  })

  it('allows Mapbox browser sources when a public fitness Mapbox token is configured', () => {
    withEnv({ ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN: 'pk.test-token' }, () => {
      const scriptSources = getCspDirectiveSources('script-src')
      const styleSources = getCspDirectiveSources('style-src')
      const connectSources = getCspDirectiveSources('connect-src')

      expect(scriptSources).toContain('https://api.mapbox.com')
      expect(styleSources).toContain('https://api.mapbox.com')
      expect(connectSources).toEqual(
        expect.arrayContaining([
          'https://api.mapbox.com',
          'https://events.mapbox.com',
          'https://*.tiles.mapbox.com'
        ])
      )
    })
  })

  it('omits Mapbox browser sources for server-only fitness Mapbox tokens', () => {
    withEnv({ ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN: 'sk.test-token' }, () => {
      const csp = getSecurityHeaders().find(
        (header) => header.key === 'Content-Security-Policy'
      )

      expect(csp?.value).not.toContain('mapbox.com')
    })
  })

  it('disables next/image optimization for unbounded federated avatars', () => {
    expect(nextConfig.images?.unoptimized).toBe(true)
  })

  it('allows configured object storage connections without allowing all HTTPS', () => {
    withEnv(
      { ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'uploads.example.com' },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toContain('https://uploads.example.com')
        expect(connectSources).not.toContain('https:')
      }
    )
  })

  it('allows local object storage connections in development', () => {
    withEnv(
      {
        NODE_ENV: 'development',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'http://localhost:9000'
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toContain('http://localhost:9000')
      }
    )
  })

  it('allows local object storage images in development', () => {
    withEnv(
      {
        NODE_ENV: 'development',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'http://localhost:9000'
      },
      () => {
        const imageSources = getCspDirectiveSources('img-src')

        expect(imageSources).toEqual([
          "'self'",
          'data:',
          'blob:',
          'https:',
          'http://localhost:9000'
        ])
      }
    )
  })

  it('allows default S3 presigned upload hosts in connect-src', () => {
    withEnv(
      {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'media-bucket',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'eu-west-1',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: undefined
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toEqual(
          expect.arrayContaining([
            'https://media-bucket.s3.eu-west-1.amazonaws.com',
            'https://s3.eu-west-1.amazonaws.com'
          ])
        )
      }
    )
  })

  it('allows default S3 presigned upload hosts for object media storage in connect-src', () => {
    withEnv(
      {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'media-object-bucket',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-2',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: undefined
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toEqual(
          expect.arrayContaining([
            'https://media-object-bucket.s3.us-east-2.amazonaws.com',
            'https://s3.us-east-2.amazonaws.com'
          ])
        )
      }
    )
  })

  it('allows configured fitness object storage connections in connect-src', () => {
    withEnv(
      {
        ACTIVITIES_FITNESS_STORAGE_TYPE: 'object',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: 'fitness.example.com'
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toContain('https://fitness.example.com')
      }
    )
  })

  it('allows default S3 presigned upload hosts for fitness storage in connect-src', () => {
    withEnv(
      {
        ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
        ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-bucket',
        ACTIVITIES_FITNESS_STORAGE_REGION: 'ap-south-1',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: undefined
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toEqual(
          expect.arrayContaining([
            'https://fitness-bucket.s3.ap-south-1.amazonaws.com',
            'https://s3.ap-south-1.amazonaws.com'
          ])
        )
      }
    )
  })

  it('allows default S3 presigned upload hosts for object fitness storage in connect-src', () => {
    withEnv(
      {
        ACTIVITIES_FITNESS_STORAGE_TYPE: 'object',
        ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-object-bucket',
        ACTIVITIES_FITNESS_STORAGE_REGION: 'ca-central-1',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: undefined
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toEqual(
          expect.arrayContaining([
            'https://fitness-object-bucket.s3.ca-central-1.amazonaws.com',
            'https://s3.ca-central-1.amazonaws.com'
          ])
        )
      }
    )
  })

  it('allows media and fitness custom storage hostnames in connect-src', () => {
    withEnv(
      {
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'media.example.com',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: 'fitness.example.com'
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toEqual(
          expect.arrayContaining([
            'https://media.example.com',
            'https://fitness.example.com'
          ])
        )
      }
    )
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
        hostname: 'media.example.com'
      },
      {
        protocol: 'https',
        hostname: 'cdn.example.com',
        pathname: '/Images/**'
      }
    ])
  })

  it('keeps the configured instance host with explicit image host patterns', () => {
    const originalHost = process.env.ACTIVITIES_HOST
    process.env.ACTIVITIES_HOST = 'social.example.com'

    try {
      const patterns = getImageRemotePatterns(
        JSON.stringify(['media.example.com'])
      )

      expect(patterns).toEqual([
        {
          protocol: 'https',
          hostname: 'media.example.com'
        },
        {
          protocol: 'https',
          hostname: 'social.example.com'
        }
      ])
    } finally {
      if (originalHost === undefined) {
        delete process.env.ACTIVITIES_HOST
      } else {
        process.env.ACTIVITIES_HOST = originalHost
      }
    }
  })

  it('normalizes default HTTPS ports in image host patterns', () => {
    const patterns = getImageRemotePatterns(
      JSON.stringify(['https://cdn.example.com:443/Images'])
    )

    expect(patterns).toEqual([
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
