import fs from 'fs'
import os from 'os'
import path from 'path'

import nextConfig from './next.config'
import { setNodeEnv } from './next.config.testUtils'

const loadNextConfig = async () => {
  vi.resetModules()
  return import('./next.config')
}

describe('next config runtime isolation', () => {
  const originalCwd = process.cwd()
  const originalEnv = {
    ACTIVITIES_ALLOW_MEDIA_DOMAINS: process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS,
    ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS:
      process.env.ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS,
    ACTIVITIES_EMAIL: process.env.ACTIVITIES_EMAIL,
    ACTIVITIES_EMAIL_TYPE: process.env.ACTIVITIES_EMAIL_TYPE,
    ACTIVITIES_GALLERY_GBIF_ENDPOINT:
      process.env.ACTIVITIES_GALLERY_GBIF_ENDPOINT,
    ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT:
      process.env.ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT,
    ACTIVITIES_GALLERY_SUBJECTS_MODEL:
      process.env.ACTIVITIES_GALLERY_SUBJECTS_MODEL,
    ACTIVITIES_HOST: process.env.ACTIVITIES_HOST,
    NODE_ENV: process.env.NODE_ENV
  }

  let tempDirectory: string

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-next-'))
    process.chdir(tempDirectory)
    process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS = 'not-json'
    process.env.ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS = 'not-json'
    delete process.env.ACTIVITIES_EMAIL
    delete process.env.ACTIVITIES_EMAIL_TYPE
    // Gallery lookups are server-side only: even invalid values must not reach
    // the next config, its CSP or its image patterns.
    process.env.ACTIVITIES_GALLERY_GBIF_ENDPOINT = 'not a url'
    process.env.ACTIVITIES_GALLERY_NOMINATIM_ENDPOINT = 'http://10.0.0.1'
    process.env.ACTIVITIES_GALLERY_SUBJECTS_MODEL = 'x'
    process.env.ACTIVITIES_HOST = 'build-host-should-not-be-used.example.com'
    setNodeEnv('production')
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

  it('lets proxy handle trailing slashes per route', async () => {
    const { default: loadedNextConfig } = await loadNextConfig()

    expect(loadedNextConfig.skipTrailingSlashRedirect).toBe(true)
  })

  it.each([
    {
      description: 'email variables are absent',
      email: undefined,
      type: undefined
    },
    {
      description: 'email JSON is malformed',
      email: 'not-json',
      type: undefined
    },
    {
      description: 'the removed Lambda provider is selected through JSON',
      email: JSON.stringify({ type: 'lambda' }),
      type: undefined
    },
    {
      description: 'the removed Lambda provider is selected through variables',
      email: undefined,
      type: 'lambda'
    }
  ])(
    'does not consume runtime email config when $description',
    async ({ email, type }) => {
      if (email === undefined) {
        delete process.env.ACTIVITIES_EMAIL
      } else {
        process.env.ACTIVITIES_EMAIL = email
      }
      if (type === undefined) {
        delete process.env.ACTIVITIES_EMAIL_TYPE
      } else {
        process.env.ACTIVITIES_EMAIL_TYPE = type
      }

      const { default: loadedNextConfig } = await loadNextConfig()

      expect(loadedNextConfig.env).toBeUndefined()
      expect(loadedNextConfig.images?.remotePatterns).toEqual([
        {
          protocol: 'https',
          hostname: '**'
        }
      ])
    }
  )

  it('includes required standalone packages in outputFileTracingIncludes', async () => {
    const { default: loadedNextConfig } = await loadNextConfig()

    expect(loadedNextConfig.outputFileTracingIncludes?.['/**/*']).toEqual(
      expect.arrayContaining([
        './node_modules/sharp/**/*',
        './node_modules/@img/**/*',
        './node_modules/@google-cloud/tasks/**/*'
      ])
    )
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

describe('next config trailing slash redirects', () => {
  it('removes one trailing slash before filesystem routing except the Wahoo callback', async () => {
    const redirects = await nextConfig.redirects?.()

    expect(redirects).toEqual([
      {
        source: '/:path((?!api/v1/webhooks/wahoo/$).*)/',
        destination: '/:path',
        permanent: true
      }
    ])
  })
})
