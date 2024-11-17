import { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  assetPrefix: '/activities',
<<<<<<< HEAD:next.config.js
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: [
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
      'resend',
      'google-proto-files'
    ]
  },
=======
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
    'resend'
  ],
>>>>>>> main:next.config.ts
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
module.exports = nextConfig
