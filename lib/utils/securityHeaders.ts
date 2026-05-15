import { getSecurityHeaderConfig } from '@/lib/config/securityHeaders'
import {
  type SecurityHeader,
  getStaticSecurityHeaders
} from '@/lib/utils/staticSecurityHeaders'

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

const getDefaultS3CspSources = (storage: unknown) => {
  if (!isS3CompatibleStorage(storage)) return []

  if (!['s3', 'object'].includes(storage.type) || storage.hostname?.trim()) {
    return []
  }

  const bucket = storage.bucket.trim()
  const region = storage.region.trim()
  if (!bucket || !region) return []

  return [
    `https://${bucket}.s3.${region}.amazonaws.com`,
    `https://s3.${region}.amazonaws.com`
  ]
}

const hasPublicMapboxAccessToken = (
  fitnessStorage: ReturnType<typeof getSecurityHeaderConfig>['fitnessStorage']
) => fitnessStorage?.mapboxAccessToken?.trim().startsWith('pk.') ?? false

export const getContentSecurityPolicy = () => {
  const { mediaStorage, fitnessStorage } = getSecurityHeaderConfig()
  const mediaStorageSource = getCspSource(getStorageHostname(mediaStorage))
  const fitnessStorageSource = getCspSource(getStorageHostname(fitnessStorage))
  const allowMapboxSources = hasPublicMapboxAccessToken(fitnessStorage)
  const connectSources = Array.from(
    new Set([
      "'self'",
      ...(allowMapboxSources ? MAPBOX_CSP_SOURCES : []),
      ...(mediaStorageSource ? [mediaStorageSource] : []),
      ...(fitnessStorageSource ? [fitnessStorageSource] : []),
      ...getDefaultS3CspSources(mediaStorage),
      ...getDefaultS3CspSources(fitnessStorage),
      ...(isDevelopment() ? ['ws:', 'wss:'] : [])
    ])
  ).join(' ')
  const imageSources = [
    "'self'",
    'data:',
    'blob:',
    'https:',
    ...(mediaStorageSource ? [mediaStorageSource] : [])
  ].join(' ')
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

  return [
    "default-src 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // Static Next headers cannot attach a per-request nonce to framework
    // hydration scripts, so inline scripts remain allowed but origins do not.
    `script-src ${scriptSources}`,
    `style-src ${styleSources}`,
    // Federated avatars and remote emoji are intentionally unbounded browser
    // image loads. next/image optimization is disabled so this does not
    // reintroduce arbitrary server-side media fetches.
    `img-src ${imageSources}`,
    `connect-src ${connectSources}`,
    "font-src 'self' data:",
    "manifest-src 'self'",
    "media-src 'self' https: blob:",
    "worker-src 'self' blob:"
  ].join('; ')
}

export const getSecurityHeaders = ({
  includeContentSecurityPolicy = true
} = {}): SecurityHeader[] => [
  ...(includeContentSecurityPolicy
    ? [
        {
          key: 'Content-Security-Policy',
          value: getContentSecurityPolicy()
        }
      ]
    : []),
  ...getStaticSecurityHeaders()
]
