import fs from 'fs'
import os from 'os'
import path from 'path'

import { getImageRemotePatterns } from '@/lib/config/nextImageRemotePatterns'
import { getSecurityHeaders } from '@/lib/utils/securityHeaders'

import nextConfig from './next.config'

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

describe('next config runtime isolation', () => {
  const originalCwd = process.cwd()
  const originalEnv = {
    ACTIVITIES_ALLOW_MEDIA_DOMAINS: process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS,
    ACTIVITIES_HOST: process.env.ACTIVITIES_HOST,
    NODE_ENV: process.env.NODE_ENV
  }

  let tempDirectory: string

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-next-'))
    process.chdir(tempDirectory)
    process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS = 'not-json'
    process.env.ACTIVITIES_HOST = 'build-host-should-not-be-used.example.com'
    process.env.NODE_ENV = 'production'
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        host: 'file-host-should-not-be-used.example.com',
        trustedHosts: ['file-edge-should-not-be-used.example.com']
      })
    )
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDirectory, { force: true, recursive: true })
    jest.resetModules()

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('does not read deployment config while loading next config', async () => {
    const { default: loadedNextConfig } = await loadNextConfig()

    expect(loadedNextConfig.env).toBeUndefined()
    expect(loadedNextConfig.allowedDevOrigins).toBeUndefined()
    expect(loadedNextConfig.images?.remotePatterns).toEqual([
      {
        protocol: 'https',
        hostname: '**'
      }
    ])
  })

  it('does not reference ACTIVITIES runtime variables in next config source', () => {
    expect(
      fs.readFileSync(path.join(originalCwd, 'next.config.ts'), 'utf-8')
    ).not.toContain('ACTIVITIES_')
  })

  it('keeps utility declarations out of next config source', () => {
    const source = fs.readFileSync(
      path.join(originalCwd, 'next.config.ts'),
      'utf-8'
    )
    const topLevelConstNames = Array.from(
      source.matchAll(/^const\s+([A-Za-z0-9_]+)/gm)
    ).map((match) => match[1])

    expect(topLevelConstNames).toEqual(['nextConfig'])
    expect(source).not.toMatch(/^export\s+const\s+/m)
    expect(source).not.toMatch(/^type\s+/m)
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

  it('leaves CSP to the runtime proxy response headers', async () => {
    const headers = await nextConfig.headers?.()
    const staticHeaders = headers?.flatMap((entry) => entry.headers) ?? []

    expect(
      staticHeaders.some((header) => header.key === 'Content-Security-Policy')
    ).toBe(false)
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

  it('uses static HTTPS image patterns in production', () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      expect(getImageRemotePatterns()).toEqual([
        {
          protocol: 'https',
          hostname: '**'
        }
      ])
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }
    }
  })

  it('allows safe local image hosts in development without app config', () => {
    const originalNodeEnv = process.env.NODE_ENV
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
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = originalNodeEnv
      }
    }
  })
})
