import { getBaseURL } from '@/lib/config'
import { getSecurityHeaderConfig } from '@/lib/config/securityHeaders'

import { type SecurityHeader, getStaticSecurityHeaders } from './static'

const MAPBOX_CSP_SOURCES = [
  'https://api.mapbox.com',
  'https://events.mapbox.com',
  'https://*.tiles.mapbox.com'
]

const isDevelopment = () => process.env.NODE_ENV !== 'production'
const isSafeLocalHostname = (hostname: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase())

const getCspSource = (rawSource: string | undefined) => {
  if (!rawSource?.trim()) return null

  try {
    const url = new URL(
      rawSource.includes('://') ? rawSource : `https://${rawSource}`
    )
    const isLocal = isSafeLocalHostname(url.hostname)
    if (url.protocol !== 'https:' && !(isLocal && isDevelopment())) {
      return null
    }
    if (!isLocal && !url.hostname.includes('.')) return null

    return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}`
  } catch {
    return null
  }
}

type S3CompatibleStorage = {
  type: string
  bucket: string
  region: string
  hostname?: string
  endpoint?: string
}

const isS3CompatibleStorage = (
  storage: unknown
): storage is S3CompatibleStorage => {
  if (!storage || typeof storage !== 'object') return false

  return (
    'type' in storage &&
    'bucket' in storage &&
    'region' in storage &&
    typeof storage.type === 'string' &&
    typeof storage.bucket === 'string' &&
    typeof storage.region === 'string'
  )
}

const getStorageHostname = (storage: { hostname?: string }) => storage.hostname
const getStorageEndpoint = (storage: { endpoint?: string }) => storage.endpoint

const getDefaultS3CspSources = (storage: unknown) => {
  if (!isS3CompatibleStorage(storage)) return []

  const hasCustomEndpoint = Boolean(storage.endpoint?.trim())
  const allowsDefaultS3Sources =
    ['s3', 'object'].includes(storage.type) && !hasCustomEndpoint

  if (!allowsDefaultS3Sources) {
    return []
  }

  const bucket = storage.bucket.trim()
  const region = storage.region.trim()
  if (!bucket || !region || region.toLowerCase() === 'auto') return []

  return [
    `https://${bucket}.s3.${region}.amazonaws.com`,
    `https://s3.${region}.amazonaws.com`
  ]
}

const hasPublicMapboxAccessToken = (
  fitnessStorage: ReturnType<typeof getSecurityHeaderConfig>['fitnessStorage']
) => fitnessStorage?.mapboxAccessToken?.trim().startsWith('pk.') ?? false

const getConfiguredCspSources = (sources: string[]) =>
  sources.flatMap((source) => {
    const cspSource = getCspSource(source)
    return cspSource ? [cspSource] : []
  })

const getRemoteMediaCspSources = (
  allowRemoteMediaDomains: ReturnType<
    typeof getSecurityHeaderConfig
  >['allowRemoteMediaDomains']
) => {
  if (allowRemoteMediaDomains === null) return ['https:']
  if (allowRemoteMediaDomains.length === 0) return []

  const remoteMediaSources = getConfiguredCspSources(allowRemoteMediaDomains)
  return remoteMediaSources.length > 0 ? remoteMediaSources : ['https:']
}

let cachedContentSecurityPolicy: string | null = null

export const resetContentSecurityPolicyCacheForTests = () => {
  if (!process.env.VITEST) {
    throw new Error('resetContentSecurityPolicyCacheForTests is test-only')
  }

  cachedContentSecurityPolicy = null
}

export const getContentSecurityPolicy = () => {
  if (cachedContentSecurityPolicy) return cachedContentSecurityPolicy

  const {
    allowMediaDomains,
    allowRemoteMediaDomains,
    mediaStorage,
    fitnessStorage
  } = getSecurityHeaderConfig()
  const mediaStorageSource = getCspSource(getStorageHostname(mediaStorage))
  const fitnessStorageSource = getCspSource(getStorageHostname(fitnessStorage))
  const mediaStorageEndpointSource = getCspSource(
    getStorageEndpoint(mediaStorage)
  )
  const fitnessStorageEndpointSource = getCspSource(
    getStorageEndpoint(fitnessStorage)
  )
  const allowMapboxSources = hasPublicMapboxAccessToken(fitnessStorage)
  const serviceMediaSources = getConfiguredCspSources(allowMediaDomains)
  const remoteMediaSources = getRemoteMediaCspSources(allowRemoteMediaDomains)
  // The canonical app origin. Server-rendered pages load the logo from this
  // absolute origin (built from the same getBaseURL()) so it resolves even when
  // the page is served on a CDN alias domain; allow it explicitly so an operator
  // with a strict ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS allowlist doesn't block
  // the logo. Deriving it from getBaseURL() keeps the scheme in lockstep.
  const appOriginSource = getCspSource(getBaseURL())
  const connectSources = Array.from(
    new Set([
      "'self'",
      ...(allowMapboxSources ? MAPBOX_CSP_SOURCES : []),
      ...(mediaStorageSource ? [mediaStorageSource] : []),
      ...(fitnessStorageSource ? [fitnessStorageSource] : []),
      ...(mediaStorageEndpointSource ? [mediaStorageEndpointSource] : []),
      ...(fitnessStorageEndpointSource ? [fitnessStorageEndpointSource] : []),
      ...getDefaultS3CspSources(mediaStorage),
      ...getDefaultS3CspSources(fitnessStorage),
      ...(isDevelopment() ? ['ws:', 'wss:'] : [])
    ])
  ).join(' ')
  const imageSources = Array.from(
    new Set([
      "'self'",
      'data:',
      'blob:',
      ...(appOriginSource ? [appOriginSource] : []),
      ...remoteMediaSources,
      ...serviceMediaSources,
      ...(mediaStorageSource ? [mediaStorageSource] : [])
    ])
  ).join(' ')
  const mediaSources = Array.from(
    new Set([
      "'self'",
      ...remoteMediaSources,
      ...serviceMediaSources,
      ...(mediaStorageSource ? [mediaStorageSource] : []),
      'blob:'
    ])
  ).join(' ')
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(isDevelopment() ? ["'unsafe-eval'"] : []),
    ...(allowMapboxSources ? ['https://api.mapbox.com'] : [])
  ].join(' ')
  const styleSources = [
    "'self'",
    "'unsafe-inline'",
    ...(allowMapboxSources ? ['https://api.mapbox.com'] : [])
  ].join(' ')

  const csp = [
    "default-src 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // Next framework hydration still emits inline script/style content here;
    // nonce wiring can be added separately from runtime origin generation.
    `script-src ${scriptSources}`,
    `style-src ${styleSources}`,
    // Federated browser media defaults to HTTPS unless an operator narrows it
    // with allowRemoteMediaDomains. Service-owned media domains are additive.
    // next/image optimization is disabled so this does not reintroduce arbitrary
    // server-side media fetches.
    `img-src ${imageSources}`,
    `connect-src ${connectSources}`,
    "font-src 'self' data:",
    "manifest-src 'self'",
    `media-src ${mediaSources}`,
    "worker-src 'self' blob:"
  ].join('; ')

  cachedContentSecurityPolicy = csp
  return cachedContentSecurityPolicy
}

export const getContentSecurityPolicyHeader = (): SecurityHeader => ({
  key: 'Content-Security-Policy',
  value: getContentSecurityPolicy()
})

export const getSecurityHeaders = ({
  includeContentSecurityPolicy = true,
  includeStaticSecurityHeaders = true
} = {}): SecurityHeader[] => [
  ...(includeContentSecurityPolicy ? [getContentSecurityPolicyHeader()] : []),
  ...(includeStaticSecurityHeaders ? getStaticSecurityHeaders() : [])
]
