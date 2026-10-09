import fs from 'fs'
import os from 'os'
import path from 'path'

import { getImageRemotePatterns } from '@/lib/config/nextImageRemotePatterns'
import {
  getContentSecurityPolicy,
  getSecurityHeaders
} from '@/lib/utils/http-headers'
import { resetContentSecurityPolicyCacheForTests } from '@/lib/utils/http-headers/csp'
import nextConfig from '@/next.config'

import { setNodeEnv } from './next.config.testUtils'

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

describe('next config security hardening', () => {
  it('sets the CSP directives when no Mapbox token is configured', () => {
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
        // The click-to-play YouTube player is the only thing this app frames.
        expect(csp?.value).toContain(
          'frame-src https://www.youtube-nocookie.com'
        )
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
          'https://i.ytimg.com',
          'https:'
        ])
        expect(csp?.value).toContain("manifest-src 'self'")
        expect(mediaSources).toEqual(["'self'", 'https:', 'blob:'])
        expect(csp?.value).not.toContain("'unsafe-eval'")
        expect(csp?.value).not.toContain('mapbox.com')
        expect(connectSources).not.toContain('https:')
      }
    )
  })

  it('sets the non-CSP security headers', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN: undefined
      },
      () => {
        const headers = getSecurityHeaders()

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

  it('allows Apple MapKit JS browser sources when the Apple map provider is configured', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN: undefined,
        ACTIVITIES_FITNESS_MAP_PROVIDER: 'apple',
        ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID: 'TEAM123456',
        ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID: 'KEY1234567',
        ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----'
      },
      () => {
        const csp = getSecurityHeaders().find(
          (header) => header.key === 'Content-Security-Policy'
        )

        expect(getCspDirectiveSources('script-src')).toEqual([
          "'self'",
          "'unsafe-inline'",
          'https://cdn.apple-mapkit.com',
          "'wasm-unsafe-eval'"
        ])
        expect(getCspDirectiveSources('style-src')).toEqual([
          "'self'",
          "'unsafe-inline'",
          'https://cdn.apple-mapkit.com'
        ])
        expect(getCspDirectiveSources('connect-src')).toEqual([
          "'self'",
          'https://*.apple-mapkit.com'
        ])
        expect(getCspDirectiveSources('img-src')).toEqual([
          "'self'",
          'data:',
          'blob:',
          'https://*.apple-mapkit.com',
          'https://i.ytimg.com',
          'https:'
        ])
        expect(getCspDirectiveSources('worker-src')).toEqual([
          "'self'",
          'blob:',
          'https://*.apple-mapkit.com'
        ])
        // Apple replaces the other providers and adds no framing sources of its
        // own; the only framed origin is the fixed YouTube player host.
        expect(csp?.value).not.toContain('mapbox.com')
        expect(csp?.value).not.toContain('cdn.jsdelivr.net')
        expect(csp?.value).not.toContain('child-src')
        expect(getCspDirectiveSources('frame-src')).toEqual([
          'https://www.youtube-nocookie.com'
        ])
      }
    )
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
          'https://i.ytimg.com',
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

        // The YouTube poster host survives an emptied allowlist: it belongs to
        // a first-party feature pointed at one fixed host, not to the
        // federated media this setting governs.
        expect(imageSources).toEqual([
          "'self'",
          'data:',
          'blob:',
          'https://tiles.openfreemap.org',
          'https://i.ytimg.com'
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
        // Narrowing which federated hosts may serve media never withdraws the
        // YouTube poster host, which is a fixed part of the video card.
        expect(imageSources).toContain('https://i.ytimg.com')
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

  // `connect-src` must let the browser reach the configured storage origins
  // (presigned uploads, public hostnames, custom endpoints) and nothing else.
  it.each([
    {
      description: 'default S3 presigned upload hosts for media storage',
      env: {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'media-bucket',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'eu-west-1',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: undefined
      },
      allowed: [
        'https://media-bucket.s3.eu-west-1.amazonaws.com',
        'https://s3.eu-west-1.amazonaws.com'
      ],
      blocked: []
    },
    {
      description: 'default S3 hosts alongside a custom media hostname',
      env: {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'static.llun.social',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'eu-central-1',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'static.llun.social'
      },
      allowed: [
        'https://static.llun.social',
        'https://static.llun.social.s3.eu-central-1.amazonaws.com',
        'https://s3.eu-central-1.amazonaws.com'
      ],
      blocked: []
    },
    {
      description: 'default S3 presigned upload hosts for object media storage',
      env: {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'media-object-bucket',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-2',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: undefined
      },
      allowed: [
        'https://media-object-bucket.s3.us-east-2.amazonaws.com',
        'https://s3.us-east-2.amazonaws.com'
      ],
      blocked: []
    },
    {
      description:
        'object storage endpoints separately from public media hostnames',
      env: {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'media-object-bucket',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'auto',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'media-cdn.example.com',
        ACTIVITIES_MEDIA_STORAGE_ENDPOINT: 'https://storage.example.com'
      },
      allowed: ['https://media-cdn.example.com', 'https://storage.example.com'],
      blocked: [
        'https://media-object-bucket.s3.auto.amazonaws.com',
        'https://s3.auto.amazonaws.com'
      ]
    },
    {
      description:
        'S3 storage endpoints separately from public media hostnames',
      env: {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 's3',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'media-bucket',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'us-east-1',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'media-cdn.example.com',
        ACTIVITIES_MEDIA_STORAGE_ENDPOINT: 'https://storage.example.com'
      },
      allowed: ['https://media-cdn.example.com', 'https://storage.example.com'],
      blocked: [
        'https://media-bucket.s3.us-east-1.amazonaws.com',
        'https://s3.us-east-1.amazonaws.com'
      ]
    },
    {
      description:
        'no default AWS S3 sources for auto-region object storage without an endpoint',
      env: {
        ACTIVITIES_MEDIA_STORAGE_TYPE: 'object',
        ACTIVITIES_MEDIA_STORAGE_BUCKET: 'media-object-bucket',
        ACTIVITIES_MEDIA_STORAGE_REGION: 'auto',
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: undefined,
        ACTIVITIES_MEDIA_STORAGE_ENDPOINT: undefined
      },
      allowed: [],
      blocked: [
        'https://media-object-bucket.s3.auto.amazonaws.com',
        'https://s3.auto.amazonaws.com'
      ]
    },
    {
      description: 'configured fitness object storage hostname',
      env: {
        ACTIVITIES_FITNESS_STORAGE_TYPE: 'object',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: 'fitness.example.com'
      },
      allowed: ['https://fitness.example.com'],
      blocked: []
    },
    {
      description: 'default S3 presigned upload hosts for fitness storage',
      env: {
        ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
        ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-bucket',
        ACTIVITIES_FITNESS_STORAGE_REGION: 'ap-south-1',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: undefined
      },
      allowed: [
        'https://fitness-bucket.s3.ap-south-1.amazonaws.com',
        'https://s3.ap-south-1.amazonaws.com'
      ],
      blocked: []
    },
    {
      description: 'default S3 hosts alongside a custom fitness hostname',
      env: {
        ACTIVITIES_FITNESS_STORAGE_TYPE: 's3',
        ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-cdn-bucket',
        ACTIVITIES_FITNESS_STORAGE_REGION: 'eu-central-1',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: 'fitness-cdn.example.com'
      },
      allowed: [
        'https://fitness-cdn.example.com',
        'https://fitness-cdn-bucket.s3.eu-central-1.amazonaws.com',
        'https://s3.eu-central-1.amazonaws.com'
      ],
      blocked: []
    },
    {
      description:
        'fitness object storage endpoints separately from public fitness hostnames',
      env: {
        ACTIVITIES_FITNESS_STORAGE_TYPE: 'object',
        ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-object-bucket',
        ACTIVITIES_FITNESS_STORAGE_REGION: 'auto',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: 'fitness-cdn.example.com',
        ACTIVITIES_FITNESS_STORAGE_ENDPOINT:
          'https://fitness-storage.example.com'
      },
      allowed: [
        'https://fitness-cdn.example.com',
        'https://fitness-storage.example.com'
      ],
      blocked: [
        'https://fitness-object-bucket.s3.auto.amazonaws.com',
        'https://s3.auto.amazonaws.com'
      ]
    },
    {
      description:
        'default S3 presigned upload hosts for object fitness storage',
      env: {
        ACTIVITIES_FITNESS_STORAGE_TYPE: 'object',
        ACTIVITIES_FITNESS_STORAGE_BUCKET: 'fitness-object-bucket',
        ACTIVITIES_FITNESS_STORAGE_REGION: 'ca-central-1',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: undefined
      },
      allowed: [
        'https://fitness-object-bucket.s3.ca-central-1.amazonaws.com',
        'https://s3.ca-central-1.amazonaws.com'
      ],
      blocked: []
    },
    {
      description: 'media and fitness custom storage hostnames together',
      env: {
        ACTIVITIES_MEDIA_STORAGE_HOSTNAME: 'media.example.com',
        ACTIVITIES_FITNESS_STORAGE_HOSTNAME: 'fitness.example.com'
      },
      allowed: ['https://media.example.com', 'https://fitness.example.com'],
      blocked: []
    }
  ])('connect-src: $description', ({ env, allowed, blocked }) => {
    withEnv(env, () => {
      const connectSources = getCspDirectiveSources('connect-src')

      expect(connectSources).toEqual(expect.arrayContaining(allowed))
      for (const source of blocked) {
        expect(connectSources).not.toContain(source)
      }
    })
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
    setNodeEnv('production')

    try {
      expect(getImageRemotePatterns()).toEqual([
        {
          protocol: 'https',
          hostname: '**'
        }
      ])
    } finally {
      setNodeEnv(originalNodeEnv)
    }
  })

  it('allows safe local image hosts in development without app config', () => {
    const originalNodeEnv = process.env.NODE_ENV
    setNodeEnv('development')

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
      setNodeEnv(originalNodeEnv)
    }
  })
})

describe('gallery lookup variables', () => {
  it('do not change the CSP or the security headers', () => {
    // Every lookup is server-side, so the browser's policy has nothing to learn.
    const withLookupVariables = withEnv(
      {
        ACTIVITIES_GALLERY_GBIF_ENDPOINT: 'https://gbif.example.com/v1',
        ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT: 'https://geo.example.com',
        ACTIVITIES_GALLERY_SUBJECTS_MODEL: 'x'
      },
      () => getSecurityHeaders()
    )
    const withoutLookupVariables = withEnv(
      {
        ACTIVITIES_GALLERY_GBIF_ENDPOINT: undefined,
        ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT: undefined,
        ACTIVITIES_GALLERY_SUBJECTS_MODEL: undefined
      },
      () => getSecurityHeaders()
    )

    expect(withLookupVariables).toEqual(withoutLookupVariables)
  })
})
