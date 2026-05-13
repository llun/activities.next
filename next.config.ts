import fs from 'fs'
import { NextConfig } from 'next'
import path from 'path'

const getProxyConfigEnv = (): NonNullable<NextConfig['env']> => {
  let fileConfig: {
    host?: string
    allowActorDomains?: string[]
    trustedHosts?: string[]
  } = {}

  try {
    fileConfig = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
    )
  } catch {
    fileConfig = {}
  }

  return {
    ACTIVITIES_HOST: process.env.ACTIVITIES_HOST ?? fileConfig.host ?? '',
    ACTIVITIES_ALLOW_ACTOR_DOMAINS:
      process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS ??
      JSON.stringify(fileConfig.allowActorDomains ?? []),
    ACTIVITIES_TRUSTED_HOSTS:
      process.env.ACTIVITIES_TRUSTED_HOSTS ??
      JSON.stringify(fileConfig.trustedHosts ?? [])
  }
}

const nextConfig: NextConfig = {
  env: getProxyConfigEnv(),
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
