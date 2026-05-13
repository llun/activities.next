import fs from 'fs'
import type { NextConfig } from 'next'
import path from 'path'
import { z } from 'zod'

const ProxyFileHostConfig = z.object({
  host: z.string(),
  secretPhase: z.string(),
  allowEmails: z.string().array(),
  database: z.unknown(),
  allowActorDomains: z.string().array().optional(),
  trustedHosts: z.string().array().optional()
})

const getEnvironmentList = (key: string): string[] => {
  try {
    const value = JSON.parse(process.env[key] || '[]')
    return Array.isArray(value) ? value.filter(Boolean).map(String) : []
  } catch {
    return []
  }
}

const getEnvironmentProxyHostConfig = () => ({
  host: process.env.ACTIVITIES_HOST || '',
  allowActorDomains: getEnvironmentList('ACTIVITIES_ALLOW_ACTOR_DOMAINS'),
  trustedHosts: getEnvironmentList('ACTIVITIES_TRUSTED_HOSTS')
})

const getFileProxyHostConfig = () => {
  try {
    const parsed = ProxyFileHostConfig.parse(
      JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
      )
    )

    return {
      host: parsed.host,
      allowActorDomains: parsed.allowActorDomains ?? [],
      trustedHosts: parsed.trustedHosts ?? []
    }
  } catch {
    return null
  }
}

export const getProxyHostConfigEnv = () => {
  const config = getFileProxyHostConfig() ?? getEnvironmentProxyHostConfig()

  if (!config.host && config.allowActorDomains.length === 0) {
    return config.trustedHosts.length === 0
      ? {}
      : { ACTIVITIES_PROXY_HOST_CONFIG: JSON.stringify(config) }
  }

  return {
    ACTIVITIES_PROXY_HOST_CONFIG: JSON.stringify(config)
  }
}

const nextConfig: NextConfig = {
  env: getProxyHostConfigEnv(),
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
