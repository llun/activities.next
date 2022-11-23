/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  assetPrefix: '/activities',

  generateBuildId() {
    return `activities-${Date.now()}`
  },

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
        source: '/.well-known/:path*',
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
