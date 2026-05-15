import fs from 'fs'
import path from 'path'

export type SecurityHeaderStorageConfig = {
  type?: string
  bucket?: string
  region?: string
  hostname?: string
  mapboxAccessToken?: string
}

export type SecurityHeaderConfig = {
  mediaStorage: SecurityHeaderStorageConfig
  fitnessStorage: SecurityHeaderStorageConfig
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const getStringValue = (value: unknown) =>
  typeof value === 'string' ? value : undefined

const getStorageConfig = (value: unknown): SecurityHeaderStorageConfig => {
  if (!isRecord(value)) return {}

  return {
    type: getStringValue(value.type),
    bucket: getStringValue(value.bucket),
    region: getStringValue(value.region),
    hostname: getStringValue(value.hostname),
    mapboxAccessToken: getStringValue(value.mapboxAccessToken)
  }
}

const getFileSecurityHeaderConfig = (): SecurityHeaderConfig | null => {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
    )
    if (!isRecord(parsed)) return null
    if (!isRecord(parsed.mediaStorage) && !isRecord(parsed.fitnessStorage)) {
      return null
    }

    return {
      mediaStorage: getStorageConfig(parsed.mediaStorage),
      fitnessStorage: getStorageConfig(parsed.fitnessStorage)
    }
  } catch {
    return null
  }
}

const getEnvironmentSecurityHeaderConfig = (): SecurityHeaderConfig => ({
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

export const getSecurityHeaderConfig = (): SecurityHeaderConfig =>
  getFileSecurityHeaderConfig() ?? getEnvironmentSecurityHeaderConfig()
