import fs from 'fs'
import os from 'os'
import path from 'path'

import { getImageRemotePatterns } from '@/lib/config/nextImageRemotePatterns'
import {
  getContentSecurityPolicy,
  getSecurityHeaders
} from '@/lib/utils/http-headers'
import { resetContentSecurityPolicyCacheForTests } from '@/lib/utils/http-headers/csp'

import nextConfig from './next.config'

const loadNextConfig = async () => {
  vi.resetModules()
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
  resetContentSecurityPolicyCacheForTests()

  try {
    return callback()
  } finally {
    resetContentSecurityPolicyCacheForTests()
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
    ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS:
      process.env.ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS,
    ACTIVITIES_HOST: process.env.ACTIVITIES_HOST,
    NODE_ENV: process.env.NODE_ENV
  }

  let tempDirectory: string

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-next-'))
    process.chdir(tempDirectory)
    process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS = 'not-json'
    process.env.ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS = 'not-json'
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
    vi.resetModules()

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

  it('documents the runtime media CSP allowlist in env example', () => {
    const envExample = fs.readFileSync(
      path.join(originalCwd, '.env.example'),
      'utf-8'
    )

    expect(envExample).toContain('ACTIVITIES_ALLOW_MEDIA_DOMAINS')
    expect(envExample).toContain(
      'ACTIVITIES_ALLOW_MEDIA_DOMAINS=["media.example.com","cdn.example.org"]'
    )
    expect(envExample).toContain('ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS')
    expect(envExample).toContain(
      'ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS=["remote-media.example.com"]'
    )
    expect(envExample).toContain('images, avatars, emoji, video, and audio')
    expect(envExample).toContain('Leave unset or blank')
    expect(envExample).toContain('set [] to block all remote media sources')
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

describe('next config nodeinfo rewrites', () => {
  const getRewrites = async () => {
    const rules = await nextConfig.rewrites?.()
    if (!rules || Array.isArray(rules)) return rules ?? []
    return rules.afterFiles ?? []
  }

  const indexOfSource = (rules: { source: string }[], source: string): number =>
    rules.findIndex((rule) => rule.source === source)

  it('routes the standard .well-known/nodeinfo paths to /api/nodeinfo', async () => {
    const rules = await getRewrites()

    expect(rules).toContainEqual({
      source: '/.well-known/nodeinfo/:path*',
      destination: '/api/nodeinfo/:path*'
    })
    expect(rules).toContainEqual({
      source: '/.wellknown/nodeinfo/:path*',
      destination: '/api/nodeinfo/:path*'
    })
    expect(rules).toContainEqual({
      source: '/nodeinfo/:path*',
      destination: '/api/nodeinfo/:path*'
    })
  })

  it('orders the nodeinfo rules before the generic .well-known catch-all', async () => {
    const rules = await getRewrites()

    const nodeInfoIndex = indexOfSource(rules, '/.well-known/nodeinfo/:path*')
    const catchAllIndex = indexOfSource(rules, '/.well-known/:path*')

    expect(nodeInfoIndex).toBeGreaterThanOrEqual(0)
    expect(catchAllIndex).toBeGreaterThanOrEqual(0)
    expect(nodeInfoIndex).toBeLessThan(catchAllIndex)
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
        const imageSources = getCspDirectiveSources('img-src')
        const mediaSources = getCspDirectiveSources('media-src')

        expect(csp?.value).toContain("default-src 'none'")
        expect(csp?.value).toContain("frame-ancestors 'none'")
        // No Mapbox token → the keyless MapLibre + OpenFreeMap map provider is
        // allowed instead (jsDelivr for the script/style, OpenFreeMap for the
        // tiles), so the region picker still shows a real interactive map.
        expect(scriptSources).toEqual([
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net'
        ])
        expect(styleSources).toEqual([
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net'
        ])
        expect(connectSources).toEqual([
          "'self'",
          'https://tiles.openfreemap.org'
        ])
        expect(imageSources).toEqual([
          "'self'",
          'data:',
          'blob:',
          'https://tiles.openfreemap.org',
          'https:'
        ])
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
          "'unsafe-eval'",
          'https://cdn.jsdelivr.net'
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
          'https://tiles.openfreemap.org',
          'https:',
          'http://localhost:9000'
        ])
      }
    )
  })

  it('adds configured service media domains without narrowing remote media sources', () => {
    withEnv(
      {
        ACTIVITIES_ALLOW_MEDIA_DOMAINS: JSON.stringify([
          'images.example.com',
          'https://cdn.example.com/assets'
        ])
      },
      () => {
        const imageSources = getCspDirectiveSources('img-src')
        const mediaSources = getCspDirectiveSources('media-src')

        expect(imageSources).toEqual(
          expect.arrayContaining([
            "'self'",
            'data:',
            'blob:',
            'https:',
            'https://images.example.com',
            'https://cdn.example.com'
          ])
        )
        expect(mediaSources).toEqual(
          expect.arrayContaining([
            "'self'",
            'blob:',
            'https:',
            'https://images.example.com',
            'https://cdn.example.com'
          ])
        )
      }
    )
  })

  it('documents that an explicit empty remote media allowlist blocks federated media sources', () => {
    withEnv(
      {
        ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS: '[]'
      },
      () => {
        const imageSources = getCspDirectiveSources('img-src')
        const mediaSources = getCspDirectiveSources('media-src')

        expect(imageSources).toEqual([
          "'self'",
          'data:',
          'blob:',
          'https://tiles.openfreemap.org'
        ])
        expect(mediaSources).toEqual(["'self'", 'blob:'])
        expect(imageSources).not.toContain('https:')
        expect(mediaSources).not.toContain('https:')
      }
    )
  })

  it('treats blank remote media allowlist as unset for federated media sources', () => {
    withEnv(
      {
        ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS: ''
      },
      () => {
        const imageSources = getCspDirectiveSources('img-src')
        const mediaSources = getCspDirectiveSources('media-src')

        expect(imageSources).toEqual(
          expect.arrayContaining(["'self'", 'data:', 'blob:', 'https:'])
        )
        expect(mediaSources).toEqual(
          expect.arrayContaining(["'self'", 'blob:', 'https:'])
        )
      }
    )
  })

  it('preserves default remote media sources when a non-empty allowlist normalizes empty', () => {
    withEnv(
      {
        ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS: JSON.stringify([
          'http://remote-media.example.com',
          'notahost'
        ])
      },
      () => {
        const imageSources = getCspDirectiveSources('img-src')
        const mediaSources = getCspDirectiveSources('media-src')

        expect(imageSources).toEqual(
          expect.arrayContaining(["'self'", 'data:', 'blob:', 'https:'])
        )
        expect(mediaSources).toEqual(
          expect.arrayContaining(["'self'", 'blob:', 'https:'])
        )
      }
    )
  })

  it('does not restore broad remote media sources when a remote allowlist has valid sources', () => {
    withEnv(
      {
        ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS: JSON.stringify([
          'http://remote-media.example.com',
          'remote-cdn.example.com'
        ])
      },
      () => {
        const imageSources = getCspDirectiveSources('img-src')
        const mediaSources = getCspDirectiveSources('media-src')

        expect(imageSources).toEqual(
          expect.arrayContaining([
            "'self'",
            'data:',
            'blob:',
            'https://remote-cdn.example.com'
          ])
        )
        expect(imageSources).not.toContain('https:')
        expect(imageSources).not.toContain('http://remote-media.example.com')
        expect(mediaSources).toEqual(
          expect.arrayContaining([
            "'self'",
            'blob:',
            'https://remote-cdn.example.com'
          ])
        )
        expect(mediaSources).not.toContain('https:')
        expect(mediaSources).not.toContain('http://remote-media.example.com')
      }
    )
  })

  it('uses configured remote media domains as the runtime remote media allowlist', () => {
    withEnv(
      {
        ACTIVITIES_ALLOW_MEDIA_DOMAINS: JSON.stringify([
          'local-media.example.com'
        ]),
        ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS: JSON.stringify([
          'remote-media.example.com',
          'https://remote-cdn.example.com/assets'
        ])
      },
      () => {
        const imageSources = getCspDirectiveSources('img-src')
        const mediaSources = getCspDirectiveSources('media-src')

        expect(imageSources).toEqual(
          expect.arrayContaining([
            "'self'",
            'data:',
            'blob:',
            'https://local-media.example.com',
            'https://remote-media.example.com',
            'https://remote-cdn.example.com'
          ])
        )
        expect(imageSources).not.toContain('https:')
        expect(mediaSources).toEqual(
          expect.arrayContaining([
            "'self'",
            'blob:',
            'https://local-media.example.com',
            'https://remote-media.example.com',
            'https://remote-cdn.example.com'
          ])
        )
        expect(mediaSources).not.toContain('https:')
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

  it('allows default S3 presigned upload hosts alongside a custom media hostname in connect-src', () => {
    withEnv(
      {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'static.llun.social',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'eu-central-1',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'static.llun.social'
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toEqual(
          expect.arrayContaining([
            'https://static.llun.social',
            'https://static.llun.social.s3.eu-central-1.amazonaws.com',
            'https://s3.eu-central-1.amazonaws.com'
          ])
        )
      }
    )
  })

  it('caches CSP for the process lifetime', () => {
    withEnv(
      {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'initial-bucket',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'eu-west-1',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: undefined
      },
      () => {
        const initialPolicy = getContentSecurityPolicy()

        process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = 'updated-bucket'

        expect(getContentSecurityPolicy()).toBe(initialPolicy)

        resetContentSecurityPolicyCacheForTests()
        expect(getContentSecurityPolicy()).toContain('updated-bucket')
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

  it('allows object storage endpoints separately from public media hostnames in connect-src', () => {
    withEnv(
      {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'media-object-bucket',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'auto',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'media-cdn.example.com',
        ACTIVITIES_MEDIA_STORAGE_ENDPOINT: 'https://storage.example.com'
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toEqual(
          expect.arrayContaining([
            'https://media-cdn.example.com',
            'https://storage.example.com'
          ])
        )
        expect(connectSources).not.toContain(
          'https://media-object-bucket.s3.auto.amazonaws.com'
        )
        expect(connectSources).not.toContain('https://s3.auto.amazonaws.com')
      }
    )
  })

  it('allows S3 storage endpoints separately from public media hostnames in connect-src', () => {
    withEnv(
      {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'media-bucket',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'media-cdn.example.com',
        ACTIVITIES_MEDIA_STORAGE_ENDPOINT: 'https://storage.example.com'
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toEqual(
          expect.arrayContaining([
            'https://media-cdn.example.com',
            'https://storage.example.com'
          ])
        )
        expect(connectSources).not.toContain(
          'https://media-bucket.s3.us-east-1.amazonaws.com'
        )
        expect(connectSources).not.toContain(
          'https://s3.us-east-1.amazonaws.com'
        )
      }
    )
  })

  it('does not allow default AWS S3 sources for auto-region object storage without an endpoint', () => {
    withEnv(
      {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'media-object-bucket',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'auto',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: undefined,
        ACTIVITIES_MEDIA_STORAGE_ENDPOINT: undefined
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).not.toContain(
          'https://media-object-bucket.s3.auto.amazonaws.com'
        )
        expect(connectSources).not.toContain('https://s3.auto.amazonaws.com')
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

  it('allows default S3 presigned upload hosts alongside a custom fitness hostname in connect-src', () => {
    withEnv(
      {
        ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
        ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-cdn-bucket',
        ACTIVITIES_FITNESS_STORAGE_REGION: 'eu-central-1',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: 'fitness-cdn.example.com'
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toEqual(
          expect.arrayContaining([
            'https://fitness-cdn.example.com',
            'https://fitness-cdn-bucket.s3.eu-central-1.amazonaws.com',
            'https://s3.eu-central-1.amazonaws.com'
          ])
        )
      }
    )
  })

  it('allows fitness object storage endpoints separately from public fitness hostnames in connect-src', () => {
    withEnv(
      {
        ACTIVITIES_FITNESS_STORAGE_TYPE: 'object',
        ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-object-bucket',
        ACTIVITIES_FITNESS_STORAGE_REGION: 'auto',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: 'fitness-cdn.example.com',
        ACTIVITIES_FITNESS_STORAGE_ENDPOINT:
          'https://fitness-storage.example.com'
      },
      () => {
        const connectSources = getCspDirectiveSources('connect-src')

        expect(connectSources).toEqual(
          expect.arrayContaining([
            'https://fitness-cdn.example.com',
            'https://fitness-storage.example.com'
          ])
        )
        expect(connectSources).not.toContain(
          'https://fitness-object-bucket.s3.auto.amazonaws.com'
        )
        expect(connectSources).not.toContain('https://s3.auto.amazonaws.com')
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

  it('ignores runtime config file storage origins in connect-src', () => {
    const originalCwd = process.cwd()
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'activities-next-')
    )
    const originalEnv = {
      ACTIVITIES_MEDIA_STORAGE_TYPE: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
      ACTIVITIES_MEDIA_STORAGE_BUCKET:
        process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET,
      ACTIVITIES_MEDIA_STORAGE_REGION:
        process.env.ACTIVITIES_MEDIA_STORAGE_REGION,
      ACTIVITIES_MEDIA_STORAGE_HOSTNAME:
        process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME,
      ACTIVITIES_MEDIA_STORAGE_ENDPOINT:
        process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT,
      ACTIVITIES_FITNESS_STORAGE_TYPE:
        process.env.ACTIVITIES_FITNESS_STORAGE_TYPE,
      ACTIVITIES_FITNESS_STORAGE_BUCKET:
        process.env.ACTIVITIES_FITNESS_STORAGE_BUCKET,
      ACTIVITIES_FITNESS_STORAGE_REGION:
        process.env.ACTIVITIES_FITNESS_STORAGE_REGION,
      ACTIVITIES_FITNESS_STORAGE_HOSTNAME:
        process.env.ACTIVITIES_FITNESS_STORAGE_HOSTNAME,
      ACTIVITIES_FITNESS_STORAGE_ENDPOINT:
        process.env.ACTIVITIES_FITNESS_STORAGE_ENDPOINT,
      ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN:
        process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN
    }

    for (const key of Object.keys(originalEnv)) {
      delete process.env[key]
    }

    process.chdir(tempDirectory)
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        mediaStorage: {
          type: 's3',
          bucket: 'file-media-bucket',
          region: 'eu-central-1'
        },
        fitnessStorage: {
          type: 'object',
          bucket: 'file-fitness-bucket',
          region: 'us-east-1',
          hostname: 'fitness-file.example.com',
          mapboxAccessToken: 'pk.file-mapbox'
        }
      })
    )

    try {
      resetContentSecurityPolicyCacheForTests()
      const connectSources = getCspDirectiveSources('connect-src')

      expect(connectSources).not.toContain(
        'https://file-media-bucket.s3.eu-central-1.amazonaws.com'
      )
      expect(connectSources).not.toContain(
        'https://s3.eu-central-1.amazonaws.com'
      )
      expect(connectSources).not.toContain('https://fitness-file.example.com')
      expect(connectSources).not.toContain('https://api.mapbox.com')
      expect(connectSources).not.toContain('https://events.mapbox.com')
      expect(connectSources).not.toContain('https://*.tiles.mapbox.com')
    } finally {
      resetContentSecurityPolicyCacheForTests()
      process.chdir(originalCwd)
      fs.rmSync(tempDirectory, { force: true, recursive: true })

      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  it('layers environment storage origins over runtime config file storage origins in connect-src', () => {
    const originalCwd = process.cwd()
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'activities-next-')
    )
    const originalEnv = {
      ACTIVITIES_MEDIA_STORAGE_TYPE: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
      ACTIVITIES_MEDIA_STORAGE_BUCKET:
        process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET,
      ACTIVITIES_MEDIA_STORAGE_REGION:
        process.env.ACTIVITIES_MEDIA_STORAGE_REGION,
      ACTIVITIES_MEDIA_STORAGE_HOSTNAME:
        process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME,
      ACTIVITIES_MEDIA_STORAGE_ENDPOINT:
        process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT
    }

    for (const key of Object.keys(originalEnv)) {
      delete process.env[key]
    }

    process.chdir(tempDirectory)
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        mediaStorage: {
          type: 's3',
          bucket: 'file-media-bucket',
          region: 'eu-central-1'
        }
      })
    )

    try {
      withEnv(
        {
          ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'env-media.example.com'
        },
        () => {
          const connectSources = getCspDirectiveSources('connect-src')

          expect(connectSources).toContain('https://env-media.example.com')
          expect(connectSources).not.toContain(
            'https://file-media-bucket.s3.eu-central-1.amazonaws.com'
          )
          expect(connectSources).not.toContain(
            'https://s3.eu-central-1.amazonaws.com'
          )
        }
      )
    } finally {
      resetContentSecurityPolicyCacheForTests()
      process.chdir(originalCwd)
      fs.rmSync(tempDirectory, { force: true, recursive: true })

      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  it('falls back to environment storage origins when config file has no storage settings', () => {
    const originalCwd = process.cwd()
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'activities-next-')
    )

    process.chdir(tempDirectory)
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({ host: 'example.com' })
    )

    try {
      resetContentSecurityPolicyCacheForTests()
      withEnv(
        {
          ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'env-media.example.com',
          ACTIVITIES_FITNESS_STORAGE_HOSTNAME: undefined
        },
        () => {
          const connectSources = getCspDirectiveSources('connect-src')

          expect(connectSources).toContain('https://env-media.example.com')
        }
      )
    } finally {
      resetContentSecurityPolicyCacheForTests()
      process.chdir(originalCwd)
      fs.rmSync(tempDirectory, { force: true, recursive: true })
    }
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
