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
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**'
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
