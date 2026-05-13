import fs from 'fs'
import { NextConfig } from 'next'
import path from 'path'

const getProxyHostConfigEnv = () => {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
    )
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    const fileConfig = parsed as {
      host?: unknown
      allowActorDomains?: unknown
      trustedHosts?: unknown
    }

    return {
      ACTIVITIES_PROXY_HOST_CONFIG: JSON.stringify({
        host: typeof fileConfig.host === 'string' ? fileConfig.host : '',
        allowActorDomains: Array.isArray(fileConfig.allowActorDomains)
          ? fileConfig.allowActorDomains
          : [],
        trustedHosts: Array.isArray(fileConfig.trustedHosts)
          ? fileConfig.trustedHosts
          : []
      })
    }
  } catch {
    return {}
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
