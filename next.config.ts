import fs from 'fs'
import type { NextConfig } from 'next'
import path from 'path'

import { getSecurityHeaders as getRuntimeSecurityHeaders } from '@/lib/utils/securityHeaders'

export { getSecurityHeaders } from '@/lib/utils/securityHeaders'

const toStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(Boolean).map(String) : []

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const getFileProxyHostConfig = () => {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
    )
    if (!isRecord(parsed)) return null

    const hasHostConfig =
      typeof parsed.host === 'string' || Array.isArray(parsed.trustedHosts)
    if (!hasHostConfig) return null

    return {
      host: typeof parsed.host === 'string' ? parsed.host : '',
      trustedHosts: toStringList(parsed.trustedHosts)
    }
  } catch {
    return null
  }
}

export const getProxyHostConfigEnv = () => {
  const config = getFileProxyHostConfig()
  return config ? { ACTIVITIES_PROXY_HOST_CONFIG: JSON.stringify(config) } : {}
}

const proxyHostConfigEnv = getProxyHostConfigEnv()

type ImageRemotePatterns = NonNullable<
  NonNullable<NextConfig['images']>['remotePatterns']
>

const IMAGE_REMOTE_ALLOWLIST_ENV = 'ACTIVITIES_ALLOW_MEDIA_DOMAINS'
const SAFE_LOCAL_IMAGE_REMOTE_PATTERNS: ImageRemotePatterns = [
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
]

const isDevelopment = () => process.env.NODE_ENV !== 'production'
const isSafeLocalHostname = (hostname: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase())

const parseImageRemoteAllowlist = (rawAllowlist: string | undefined) => {
  try {
    const parsed = JSON.parse(rawAllowlist ?? '[]')
    if (!Array.isArray(parsed)) {
      throw new Error()
    }

    return parsed.filter(Boolean).map(String)
  } catch {
    throw new Error(`${IMAGE_REMOTE_ALLOWLIST_ENV} must be a JSON array`)
  }
}

const getImageRemotePattern = (
  rawEntry: string,
  { allowLocalHttp = false } = {}
): ImageRemotePatterns[number] | null => {
  const entry = rawEntry.trim()
  if (!entry || entry.includes('*')) return null

  try {
    const url = new URL(entry.includes('://') ? entry : `https://${entry}`)
    const isLocalHttp =
      url.protocol === 'http:' &&
      allowLocalHttp &&
      isSafeLocalHostname(url.hostname)
    if (url.protocol !== 'https:' && !isLocalHttp) return null
    if (!url.hostname || url.hostname.includes('*')) return null

    const pathname =
      url.pathname && url.pathname !== '/'
        ? `${url.pathname.replace(/\/$/, '')}/**`
        : undefined

    return {
      protocol: url.protocol.replace(':', '') as 'http' | 'https',
      hostname: url.hostname.toLowerCase(),
      ...(url.port ? { port: url.port } : {}),
      ...(pathname ? { pathname } : {})
    }
  } catch {
    return null
  }
}

const getImageRemotePatternKey = (pattern: ImageRemotePatterns[number]) =>
  [
    pattern.protocol ?? '',
    pattern.hostname,
    pattern.port ?? '',
    pattern.pathname ?? ''
  ].join('\0')

const appendInstanceImageRemotePattern = (
  patterns: ImageRemotePatterns
): ImageRemotePatterns => {
  const host = process.env.ACTIVITIES_HOST?.trim()
  if (!host) return patterns

  const instancePattern = getImageRemotePattern(host, {
    allowLocalHttp: isDevelopment()
  })
  if (!instancePattern) return patterns

  const patternKeys = new Set(patterns.map(getImageRemotePatternKey))
  if (patternKeys.has(getImageRemotePatternKey(instancePattern))) {
    return patterns
  }

  return [...patterns, instancePattern]
}

const getDefaultImageRemotePatterns = (): ImageRemotePatterns => {
  const patterns: ImageRemotePatterns = [{ protocol: 'https', hostname: '**' }]

  if (isDevelopment()) {
    patterns.push(...SAFE_LOCAL_IMAGE_REMOTE_PATTERNS)
  }

  return patterns
}

export const getImageRemotePatterns = (
  rawAllowlist = process.env[IMAGE_REMOTE_ALLOWLIST_ENV]
): ImageRemotePatterns => {
  if (rawAllowlist === undefined || rawAllowlist.trim() === '') {
    return getDefaultImageRemotePatterns()
  }

  const configuredPatterns = parseImageRemoteAllowlist(rawAllowlist).flatMap(
    (entry) => {
      const pattern = getImageRemotePattern(entry)
      return pattern ? [pattern] : []
    }
  )

  return appendInstanceImageRemotePattern(configuredPatterns)
}

const nextConfig: NextConfig = {
  ...(Object.keys(proxyHostConfigEnv).length
    ? { env: proxyHostConfigEnv }
    : {}),
  allowedDevOrigins: [process.env.ACTIVITIES_HOST ?? ''],
  reactStrictMode: true,
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  assetPrefix: '/activities',
  serverExternalPackages: [
    '@aws-sdk/client-lambda',
    '@aws-sdk/client-s3',
    '@aws-sdk/util-utf8-node',
    '@google-cloud/firestore',
    '@keyv/redis',
    'knex',
    'bcrypt',
    'better-sqlite3',
    'fluent-ffmpeg',
    'got',
    'jsonld',
    'keyv',
    'nodemailer',
    'pino',
    'pino-pretty',
    'resend',
    'thread-stream',
    'web-push'
  ],
  generateBuildId() {
    return `activities-${Date.now()}`
  },
  sassOptions: {},
  images: {
    unoptimized: true,
    remotePatterns: getImageRemotePatterns()
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: getRuntimeSecurityHeaders({
          includeContentSecurityPolicy: false
        })
      }
    ]
  },
  async rewrites() {
    return [
      {
        source: '/activities/_next/:path*',
        destination: '/_next/:path*'
      },
      {
        source: '/.well-known/:path*',
        destination: '/api/well-known/:path*'
      },
      {
        source: '/.wellknown/:path*',
        destination: '/api/well-known/:path*'
      },
      {
        source: '/users/:path*',
        destination: '/api/users/:path*'
      },
      {
        source: '/inbox',
        destination: '/api/inbox'
      },
      {
        source: '/nodeinfo',
        destination: '/api/nodeinfo'
      }
    ]
  }
}
export default nextConfig
