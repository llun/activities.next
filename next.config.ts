import type { NextConfig } from 'next'

import { getSecurityHeaders as getRuntimeSecurityHeaders } from '@/lib/utils/securityHeaders'

type ImageRemotePatterns = NonNullable<
  NonNullable<NextConfig['images']>['remotePatterns']
>

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

export const getImageRemotePatterns = (): ImageRemotePatterns => {
  const patterns: ImageRemotePatterns = [{ protocol: 'https', hostname: '**' }]

  if (isDevelopment()) {
    patterns.push(...SAFE_LOCAL_IMAGE_REMOTE_PATTERNS)
  }

  return patterns
}

const nextConfig: NextConfig = {
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
