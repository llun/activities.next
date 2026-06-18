import type { NextConfig } from 'next'

import { getImageRemotePatterns } from '@/lib/config/nextImageRemotePatterns'
// Direct sub-path import required: the barrel loads csp.ts which reads
// deployment env vars at call time, violating build-time isolation rules.
import { getStaticSecurityHeaders } from '@/lib/utils/http-headers/static'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  // sharp's native *.node binary dlopen's its libvips shared library via a
  // native RPATH, which the standalone tracer (@vercel/nft) cannot follow.
  // Since sharp 0.35 the runtime @img/sharp-libvips-* package is no longer
  // require()d from JS, so the tracer drops libvips-cpp.so from the standalone
  // output and sharp fails to load at runtime. Force the full sharp + @img
  // install (both the top-level and the copy nested under node_modules/sharp,
  // which "node_modules/sharp/**" also covers) into the trace. The Dockerfile
  // re-copies these as a guaranteed fallback in case hoisting or glob matching
  // ever changes.
  outputFileTracingIncludes: {
    '/**/*': ['./node_modules/sharp/**/*', './node_modules/@img/**/*']
  },
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
      },
      // Mastodon/OIDC clients hardcode the spec paths; the handlers live under
      // /api/oauth/* so route the standard paths there.
      {
        source: '/oauth/revoke',
        destination: '/api/oauth/revoke'
      },
      {
        source: '/oauth/userinfo',
        destination: '/api/oauth/userinfo'
      }
    ]
  }
}
export default nextConfig
