/* eslint-disable @typescript-eslint/no-var-requires */
const { withSentryConfig } = require('@sentry/nextjs')

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

const sentryWebpackPluginOptions = {
  // Additional config options for the Sentry Webpack plugin. Keep in mind that
  // the following options are set automatically, and overriding them is not
  // recommended:
  //   release, url, org, project, authToken, configFile, stripPrefix,
  //   urlPrefix, include, ignore
  project: 'javascript-nextjs',
  silent: true // Suppresses all logs
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options.
}

module.exports =
  process.env.NODE_ENV === 'production'
    ? withSentryConfig(
        {
          ...nextConfig,
          sentry: {
            // Use `hidden-source-map` rather than `source-map` as the Webpack `devtool`
            // for client-side builds. (This will be the default starting in
            // `@sentry/nextjs` version 8.0.0.) See
            // https://webpack.js.org/configuration/devtool/ and
            // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#use-hidden-source-map
            // for more information.
            hideSourceMaps: true
          }
        },
        sentryWebpackPluginOptions
      )
    : nextConfig
