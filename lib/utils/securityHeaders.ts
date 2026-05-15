type SecurityHeader = { key: string; value: string }

const MEDIA_STORAGE_HOSTNAME_ENV = 'ACTIVITIES_MEDIA_STORAGE_HOSTNAME'
const MEDIA_STORAGE_TYPE_ENV = 'ACTIVITIES_MEDIA_STORAGE_TYPE'
const MEDIA_STORAGE_BUCKET_ENV = 'ACTIVITIES_MEDIA_STORAGE_BUCKET'
const MEDIA_STORAGE_REGION_ENV = 'ACTIVITIES_MEDIA_STORAGE_REGION'
const FITNESS_STORAGE_HOSTNAME_ENV = 'ACTIVITIES_FITNESS_STORAGE_HOSTNAME'
const FITNESS_STORAGE_TYPE_ENV = 'ACTIVITIES_FITNESS_STORAGE_TYPE'
const FITNESS_STORAGE_BUCKET_ENV = 'ACTIVITIES_FITNESS_STORAGE_BUCKET'
const FITNESS_STORAGE_REGION_ENV = 'ACTIVITIES_FITNESS_STORAGE_REGION'
const MAPBOX_ACCESS_TOKEN_ENV = 'ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN'

const MAPBOX_CSP_SOURCES = [
  'https://api.mapbox.com',
  'https://events.mapbox.com',
  'https://*.tiles.mapbox.com'
]

const isDevelopment = () => process.env.NODE_ENV !== 'production'
const isSafeLocalHostname = (hostname: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase())
const hasPublicMapboxAccessToken = () =>
  process.env[MAPBOX_ACCESS_TOKEN_ENV]?.trim().startsWith('pk.') ?? false

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

const getDefaultS3CspSources = ({
  storageTypeEnv,
  hostnameEnv,
  bucketEnv,
  regionEnv
}: {
  storageTypeEnv: string
  hostnameEnv: string
  bucketEnv: string
  regionEnv: string
}) => {
  const storageType = process.env[storageTypeEnv]
  if (
    !['s3', 'object'].includes(storageType ?? '') ||
    process.env[hostnameEnv]
  ) {
    return []
  }

  const bucket = process.env[bucketEnv]?.trim()
  const region = process.env[regionEnv]?.trim()
  if (!bucket || !region) return []

  return [
    `https://${bucket}.s3.${region}.amazonaws.com`,
    `https://s3.${region}.amazonaws.com`
  ]
}

export const getContentSecurityPolicy = () => {
  const mediaStorageSource = getCspSource(
    process.env[MEDIA_STORAGE_HOSTNAME_ENV]
  )
  const fitnessStorageSource = getCspSource(
    process.env[FITNESS_STORAGE_HOSTNAME_ENV]
  )
  const allowMapboxSources = hasPublicMapboxAccessToken()
  const connectSources = Array.from(
    new Set([
      "'self'",
      ...(allowMapboxSources ? MAPBOX_CSP_SOURCES : []),
      ...(mediaStorageSource ? [mediaStorageSource] : []),
      ...(fitnessStorageSource ? [fitnessStorageSource] : []),
      ...getDefaultS3CspSources({
        storageTypeEnv: MEDIA_STORAGE_TYPE_ENV,
        hostnameEnv: MEDIA_STORAGE_HOSTNAME_ENV,
        bucketEnv: MEDIA_STORAGE_BUCKET_ENV,
        regionEnv: MEDIA_STORAGE_REGION_ENV
      }),
      ...getDefaultS3CspSources({
        storageTypeEnv: FITNESS_STORAGE_TYPE_ENV,
        hostnameEnv: FITNESS_STORAGE_HOSTNAME_ENV,
        bucketEnv: FITNESS_STORAGE_BUCKET_ENV,
        regionEnv: FITNESS_STORAGE_REGION_ENV
      }),
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
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY'
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  },
  {
    key: 'Permissions-Policy',
    // The same-origin settings UI uses navigator.geolocation for optional
    // fitness privacy location setup while denying cross-origin access.
    value: 'camera=(), microphone=(), geolocation=(self)'
  }
]
