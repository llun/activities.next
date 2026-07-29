import fs from 'fs'
import { NextRequest } from 'next/server'
import os from 'os'
import path from 'path'

import { resetHostConfigCacheForTests } from '@/lib/config/host'
import { resetContentSecurityPolicyCacheForTests } from '@/lib/utils/http-headers/csp'

import { proxy, config as proxyConfig } from './proxy'

const STATIC_IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g
const FILESYSTEM_MODULES = new Set(['fs', 'node:fs', 'path', 'node:path'])
// Node-only modules that are not filesystem APIs but must stay out of the
// middleware bundle all the same. `lib/utils/logger` calls `pino({…})` at
// module top level and package.json declares no `sideEffects`, so it cannot be
// tree-shaken away: one import anywhere in this graph drags pino, its
// serializers and sonic-boom into middleware.js. This has already happened
// once, from a storage helper parked in lib/config/utils (which proxy.ts
// reaches via lib/config/host), with a green build and no warning — the only
// visible trace was 264 extra files in middleware.js.nft.json.
//
// lib/config/storageValue.ts states this constraint in prose as its reason for
// existing; this is what enforces it.
const NODE_ONLY_MODULES = new Set(['pino', '@/lib/utils/logger'])
const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.mjs']

const resolveSourcePath = (rawPath: string): string | null => {
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${rawPath}${extension}`
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }

  for (const extension of SOURCE_EXTENSIONS.slice(1)) {
    const candidate = path.join(rawPath, `index${extension}`)
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }

  return null
}

const resolveLocalImport = (
  rootDirectory: string,
  fromFile: string,
  specifier: string
) => {
  if (specifier.startsWith('@/')) {
    return resolveSourcePath(path.join(rootDirectory, specifier.slice(2)))
  }

  if (specifier.startsWith('.')) {
    return resolveSourcePath(path.resolve(path.dirname(fromFile), specifier))
  }

  return null
}

const getStaticImportSpecifiers = (source: string) =>
  Array.from(source.matchAll(STATIC_IMPORT_PATTERN)).map((match) => match[1])

const getCspDirectiveSources = (
  csp: string | null,
  directiveName: string
): string[] => {
  const directive = csp
    ?.split('; ')
    .find((value) => value.startsWith(`${directiveName} `))

  return directive?.split(/\s+/).slice(1) ?? []
}

describe('proxy', () => {
  const originalCwd = process.cwd()
  const previousActivitiesHost = process.env.ACTIVITIES_HOST
  const previousAllowActorDomains = process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
  const previousMediaStorageBucket = process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET
  const previousMediaStorageEndpoint =
    process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT
  const previousMediaStorageHostname =
    process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
  const previousMediaStorageRegion = process.env.ACTIVITIES_MEDIA_STORAGE_REGION
  const previousMediaStorageType = process.env.ACTIVITIES_MEDIA_STORAGE_TYPE
  const previousTrustedHosts = process.env.ACTIVITIES_TRUSTED_HOSTS
  let tempDirectory: string

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-next-'))
    process.chdir(tempDirectory)
    resetHostConfigCacheForTests()
    resetContentSecurityPolicyCacheForTests()
    process.env.ACTIVITIES_HOST = 'public.example.com'
    delete process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS
    delete process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET
    delete process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT
    delete process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
    delete process.env.ACTIVITIES_MEDIA_STORAGE_REGION
    delete process.env.ACTIVITIES_MEDIA_STORAGE_TYPE
    delete process.env.ACTIVITIES_TRUSTED_HOSTS
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDirectory, { force: true, recursive: true })
    resetHostConfigCacheForTests()
    resetContentSecurityPolicyCacheForTests()
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

    if (previousMediaStorageBucket === undefined) {
      delete process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET
    } else {
      process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = previousMediaStorageBucket
    }

    if (previousMediaStorageEndpoint === undefined) {
      delete process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT
    } else {
      process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT =
        previousMediaStorageEndpoint
    }

    if (previousMediaStorageHostname === undefined) {
      delete process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
    } else {
      process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME =
        previousMediaStorageHostname
    }

    if (previousMediaStorageRegion === undefined) {
      delete process.env.ACTIVITIES_MEDIA_STORAGE_REGION
    } else {
      process.env.ACTIVITIES_MEDIA_STORAGE_REGION = previousMediaStorageRegion
    }

    if (previousMediaStorageType === undefined) {
      delete process.env.ACTIVITIES_MEDIA_STORAGE_TYPE
    } else {
      process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = previousMediaStorageType
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

  it('does not run the proxy on static asset paths', () => {
    expect(proxyConfig.matcher).toEqual([
      '/((?!(?:_next/static|_next/image)(?:/|$)|favicon\\.ico$|activities/_next(?:/|$)).*)'
    ])
  })

  it('matches static asset paths with path segment boundaries', () => {
    const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`)

    for (const pathname of [
      '/activities/_next',
      '/activities/_next/',
      '/activities/_next/static/chunk.js'
    ]) {
      expect(matcher.test(pathname)).toBe(false)
    }

    for (const pathname of [
      '/activities',
      '/activities/',
      '/activities/_nextish',
      '/@alice'
    ]) {
      expect(matcher.test(pathname)).toBe(true)
    }
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

  it('uses runtime host config instead of runtime config file host config', async () => {
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        host: 'file-public.example.com',
        trustedHosts: ['file-edge.example.com']
      })
    )
    process.env.ACTIVITIES_HOST = 'runtime-public.example.com'
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'runtime-edge.example.com'
    ])

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

  it('falls back to runtime host when forwarded host is not trusted', async () => {
    process.env.ACTIVITIES_HOST = 'runtime-public.example.com'
    process.env.ACTIVITIES_TRUSTED_HOSTS = JSON.stringify([
      'runtime-edge.example.com'
    ])

    const request = new NextRequest('https://internal.example.com/@alice', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'untrusted-edge.example.com'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@runtime-public.example.com'
    )
  })

  it('ignores runtime config file host config when runtime environment is absent', async () => {
    delete process.env.ACTIVITIES_HOST
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        host: 'file-public.example.com',
        trustedHosts: ['file-edge.example.com']
      })
    )

    const request = new NextRequest('https://internal.example.com/@alice', {
      method: 'GET',
      headers: {
        host: 'internal.example.com',
        'x-forwarded-host': 'file-edge.example.com'
      }
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBe(
      'https://internal.example.com/@alice@internal.example.com'
    )
  })

  it('sets CSP from runtime media storage environment on ordinary app requests', async () => {
    process.env.ACTIVITIES_MEDIA_STORAGE_TYPE = 's3'
    process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET = 'static.llun.social'
    process.env.ACTIVITIES_MEDIA_STORAGE_REGION = 'eu-central-1'

    const request = new NextRequest('https://llun.social/', {
      method: 'GET'
    })

    const response = await proxy(request)
    const connectSources = getCspDirectiveSources(
      response?.headers.get('Content-Security-Policy') ?? null,
      'connect-src'
    )

    expect(connectSources).toEqual(
      expect.arrayContaining([
        "'self'",
        'https://static.llun.social.s3.eu-central-1.amazonaws.com',
        'https://s3.eu-central-1.amazonaws.com'
      ])
    )
    expect(response?.headers.get('X-Content-Type-Options')).toBeNull()
  })

  it('sets CSP on canonical actor handles that do not need rewriting', async () => {
    const request = new NextRequest('https://llun.social/@alice@example.com', {
      method: 'GET'
    })

    const response = await proxy(request)

    expect(response?.headers.get('x-middleware-rewrite')).toBeNull()
    expect(response?.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'"
    )
  })

  // Walk proxy.ts's static import graph, reporting every disallowed specifier
  // reached and the files visited on the way. The visited set is returned so a
  // caller can prove the walk got somewhere: if module resolution ever breaks,
  // it collapses to proxy.ts alone and every "no violations" assertion below
  // passes while guarding nothing.
  const walkProxyImportGraph = (disallowed: Set<string>) => {
    const rootDirectory = originalCwd
    const visited = new Set<string>()
    const pending = [path.join(rootDirectory, 'proxy.ts')]
    const violations: string[] = []

    while (pending.length > 0) {
      const currentFile = pending.pop()
      if (!currentFile || visited.has(currentFile)) continue
      visited.add(currentFile)

      const source = fs.readFileSync(currentFile, 'utf-8')
      for (const specifier of getStaticImportSpecifiers(source)) {
        if (disallowed.has(specifier)) {
          violations.push(
            `${path.relative(rootDirectory, currentFile)} imports ${specifier}`
          )
          continue
        }

        const localImport = resolveLocalImport(
          rootDirectory,
          currentFile,
          specifier
        )
        if (localImport) pending.push(localImport)
      }
    }

    return { violations, visited }
  }

  // Both guards exist because the middleware bundle must stay free of Node-only
  // dependencies: filesystem APIs break under the Edge runtime, and the logger
  // drags pino in wholesale (see NODE_ONLY_MODULES).
  it.each([
    { description: 'filesystem modules', disallowed: FILESYSTEM_MODULES },
    { description: 'the logger', disallowed: NODE_ONLY_MODULES }
  ])(
    'keeps the proxy static import graph free of $description',
    ({ disallowed }) => {
      const { violations, visited } = walkProxyImportGraph(disallowed)

      // lib/config/utils.ts is where the logger leaked in from once, reached
      // via lib/config/host. Asserting the walk still gets there is what stops
      // a resolution failure from turning both guards green and inert.
      expect(visited).toContain(path.join(originalCwd, 'lib/config/utils.ts'))
      expect(violations).toEqual([])
    }
  )
})
