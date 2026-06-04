import type { NextConfig } from 'next'

import { getImageRemotePatterns } from '@/lib/config/nextImageRemotePatterns'
// Direct sub-path import required: the barrel loads csp.ts which reads
// deployment env vars at call time, violating build-time isolation rules.
import { getStaticSecurityHeaders } from '@/lib/utils/http-headers/static'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  assetPrefix: '/activities',
  allowedDevOrigins:
    process.env.NODE_ENV === 'development' ? ['activities.local'] : undefined,
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
        headers: getStaticSecurityHeaders()
      }
    ]
  },
  async rewrites() {
    return [
      {
        source: '/activities/_next/:path*',
        destination: '/_next/:path*'
      },
      // NodeInfo discovery and documents are served by the canonical
      // /api/nodeinfo/* handlers. Route the standard .well-known paths there
      // before the generic .well-known catch-all below so they win the match.
      {
        source: '/.well-known/nodeinfo/:path*',
        destination: '/api/nodeinfo/:path*'
      },
      {
        source: '/.wellknown/nodeinfo/:path*',
        destination: '/api/nodeinfo/:path*'
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
        source: '/nodeinfo/:path*',
        destination: '/api/nodeinfo/:path*'
      }
    ]
  }
}
export default nextConfig
