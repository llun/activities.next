import { readRuntimeConfigFile } from './runtimeConfigFile'

export type SecurityHeaderStorageConfig = {
  type?: string
  bucket?: string
  region?: string
  hostname?: string
  mapboxAccessToken?: string
}

export type SecurityHeaderConfig = {
  allowMediaDomains: string[]
  mediaStorage: SecurityHeaderStorageConfig
  fitnessStorage: SecurityHeaderStorageConfig
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const getStringValue = (value: unknown) =>
  typeof value === 'string' ? value : undefined

const toStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(Boolean).map(String) : []

const getEnvironmentStringList = (key: string): string[] => {
  try {
    return toStringList(JSON.parse(process.env[key] || '[]'))
  } catch {
    return []
  }
}

const stripUndefinedStorageConfig = (
  config: SecurityHeaderStorageConfig
): SecurityHeaderStorageConfig => {
  const nextConfig: SecurityHeaderStorageConfig = {}
  if (config.type !== undefined) nextConfig.type = config.type
  if (config.bucket !== undefined) nextConfig.bucket = config.bucket
  if (config.region !== undefined) nextConfig.region = config.region
  if (config.hostname !== undefined) nextConfig.hostname = config.hostname
  if (config.mapboxAccessToken !== undefined) {
    nextConfig.mapboxAccessToken = config.mapboxAccessToken
  }

  return nextConfig
}

const getStorageConfig = (value: unknown): SecurityHeaderStorageConfig => {
  if (!isRecord(value)) return {}

  return stripUndefinedStorageConfig({
    type: getStringValue(value.type),
    bucket: getStringValue(value.bucket),
    region: getStringValue(value.region),
    hostname: getStringValue(value.hostname),
    mapboxAccessToken: getStringValue(value.mapboxAccessToken)
  })
}

const getFileSecurityHeaderConfig = (): SecurityHeaderConfig | null => {
  const parsed = readRuntimeConfigFile()
  if (!isRecord(parsed)) return null
  if (
    !Array.isArray(parsed.allowMediaDomains) &&
    !isRecord(parsed.mediaStorage) &&
    !isRecord(parsed.fitnessStorage)
  ) {
    return null
  }

  return {
    allowMediaDomains: toStringList(parsed.allowMediaDomains),
    mediaStorage: getStorageConfig(parsed.mediaStorage),
    fitnessStorage: getStorageConfig(parsed.fitnessStorage)
  }
}

const getEnvironmentSecurityHeaderConfig = (): SecurityHeaderConfig => ({
  allowMediaDomains: getEnvironmentStringList('ACTIVITIES_ALLOW_MEDIA_DOMAINS'),
  mediaStorage: {
    type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
    bucket: process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET,
    region: process.env.ACTIVITIES_MEDIA_STORAGE_REGION,
    hostname: process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME
  },
  fitnessStorage: {
    type: process.env.ACTIVITIES_FITNESS_STORAGE_TYPE,
    bucket: process.env.ACTIVITIES_FITNESS_STORAGE_BUCKET,
    region: process.env.ACTIVITIES_FITNESS_STORAGE_REGION,
    hostname: process.env.ACTIVITIES_FITNESS_STORAGE_HOSTNAME,
    mapboxAccessToken: process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN
  }
})

export const getSecurityHeaderConfig = (): SecurityHeaderConfig => {
  const fileConfig = getFileSecurityHeaderConfig() ?? {
    allowMediaDomains: [],
    mediaStorage: {},
    fitnessStorage: {}
  }
  const environmentConfig = getEnvironmentSecurityHeaderConfig()

  return {
    allowMediaDomains: environmentConfig.allowMediaDomains.length
      ? environmentConfig.allowMediaDomains
      : fileConfig.allowMediaDomains,
    mediaStorage: {
      ...fileConfig.mediaStorage,
      ...stripUndefinedStorageConfig(environmentConfig.mediaStorage)
    },
    fitnessStorage: {
      ...fileConfig.fitnessStorage,
      ...stripUndefinedStorageConfig(environmentConfig.fitnessStorage)
    }
  }
}
