import fs from 'fs'
import type { NextConfig } from 'next'
import path from 'path'

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

type Header = { key: string; value: string }
type ImageRemotePatterns = NonNullable<
  NonNullable<NextConfig['images']>['remotePatterns']
>

const IMAGE_REMOTE_ALLOWLIST_ENV = 'ACTIVITIES_ALLOW_MEDIA_DOMAINS'
const DEFAULT_IMAGE_REMOTE_PATTERNS: ImageRemotePatterns = [
  {
    protocol: 'https',
    hostname: '**'
  }
]

const isDevelopment = () => process.env.NODE_ENV !== 'production'

export const getSecurityHeaders = (): Header[] => {
  const csp = [
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "style-src 'self' 'unsafe-inline'",
    // Browser image loads intentionally allow arbitrary HTTPS remote media.
    // next/image optimization remains separately constrained by remotePatterns.
    "img-src 'self' data: blob: https:",
    `connect-src 'self' https:${isDevelopment() ? ' ws: wss:' : ''}`,
    "font-src 'self' data:",
    "media-src 'self' https:",
    "worker-src 'self' blob:"
  ].join('; ')

  return [
    {
      key: 'Content-Security-Policy',
      value: csp
    },
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff'
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY'
    },
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin'
    },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=()'
    }
  ]
}

const parseImageRemoteAllowlist = (rawAllowlist: string | undefined) => {
  try {
    const parsed = JSON.parse(rawAllowlist ?? '[]')
    if (!Array.isArray(parsed)) {
      throw new Error()
    }

    return parsed.filter(Boolean).map(String)
  } catch {
    throw new Error(
      `${IMAGE_REMOTE_ALLOWLIST_ENV} must be a JSON array of HTTPS hostnames or URLs`
    )
  }
}

const getImageRemotePattern = (
  rawEntry: string
): ImageRemotePatterns[number] | null => {
  const entry = rawEntry.trim()
  if (!entry || entry.includes('*')) return null

  try {
    const url = new URL(entry.includes('://') ? entry : `https://${entry}`)
    if (url.protocol !== 'https:') return null
    if (!url.hostname || url.hostname.includes('*')) return null

    const pathname =
      url.pathname && url.pathname !== '/'
        ? `${url.pathname.replace(/\/$/, '')}/**`
        : undefined

    return {
      protocol: 'https',
      hostname: url.hostname.toLowerCase(),
      ...(url.port ? { port: url.port } : {}),
      ...(pathname ? { pathname } : {})
    }
  } catch {
    return null
  }
}

export const getImageRemotePatterns = (
  rawAllowlist = process.env[IMAGE_REMOTE_ALLOWLIST_ENV]
): ImageRemotePatterns => {
  if (rawAllowlist === undefined) {
    return DEFAULT_IMAGE_REMOTE_PATTERNS
  }

  return parseImageRemoteAllowlist(rawAllowlist).flatMap((entry) => {
    const pattern = getImageRemotePattern(entry)
    return pattern ? [pattern] : []
  })
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
    remotePatterns: getImageRemotePatterns()
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: getSecurityHeaders()
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
