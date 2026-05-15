import type { NextConfig } from 'next'

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
