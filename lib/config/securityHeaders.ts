// Sub-path import, not the barrel: this module is part of proxy.ts's Edge
// import graph, and the barrel's wrapper pulls in the logger.
import { getPhotoEditorConfig } from './photoEditor'
import { getEnvironmentList } from './utils'

export type SecurityHeaderStorageConfig = {
  type?: string
  bucket?: string
  region?: string
  hostname?: string
  endpoint?: string
  mapboxAccessToken?: string
}

export type SecurityHeaderConfig = {
  allowMediaDomains: string[]
  allowRemoteMediaDomains: string[] | null
  mediaStorage: SecurityHeaderStorageConfig
  fitnessStorage: SecurityHeaderStorageConfig
  // The origins the photo editor downloads its subject model from; null when
  // the model is off (it then needs neither these nor `'wasm-unsafe-eval'`).
  photoEditorModelOrigins: string[] | null
}

const getOptionalEnvironmentList = (key: string): string[] | null => {
  const value = process.env[key]
  if (value === undefined || value.trim() === '') return null

  return getEnvironmentList(key, { onInvalidList: 'throw' })
}

const stripUndefinedStorageConfig = (
  config: SecurityHeaderStorageConfig
): SecurityHeaderStorageConfig => {
  const nextConfig: SecurityHeaderStorageConfig = {}
  if (config.type !== undefined) nextConfig.type = config.type
  if (config.bucket !== undefined) nextConfig.bucket = config.bucket
  if (config.region !== undefined) nextConfig.region = config.region
  if (config.hostname !== undefined) nextConfig.hostname = config.hostname
  if (config.endpoint !== undefined) nextConfig.endpoint = config.endpoint
  if (config.mapboxAccessToken !== undefined) {
    nextConfig.mapboxAccessToken = config.mapboxAccessToken
  }

  return nextConfig
}

const getPhotoEditorModelOrigins = (): string[] | null => {
  const { subjectModel, connectOrigins } = getPhotoEditorConfig()
  return subjectModel ? connectOrigins : null
}

export const getSecurityHeaderConfig = (): SecurityHeaderConfig => ({
  allowMediaDomains: getEnvironmentList('ACTIVITIES_ALLOW_MEDIA_DOMAINS'),
  allowRemoteMediaDomains: getOptionalEnvironmentList(
    'ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS'
  ),
  mediaStorage: stripUndefinedStorageConfig({
    type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
    bucket: process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET,
    region: process.env.ACTIVITIES_MEDIA_STORAGE_REGION,
    hostname: process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME,
    endpoint: process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT
  }),
  fitnessStorage: stripUndefinedStorageConfig({
    type: process.env.ACTIVITIES_FITNESS_STORAGE_TYPE,
    bucket: process.env.ACTIVITIES_FITNESS_STORAGE_BUCKET,
    region: process.env.ACTIVITIES_FITNESS_STORAGE_REGION,
    hostname: process.env.ACTIVITIES_FITNESS_STORAGE_HOSTNAME,
    endpoint: process.env.ACTIVITIES_FITNESS_STORAGE_ENDPOINT,
    mapboxAccessToken: process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN
  }),
  photoEditorModelOrigins: getPhotoEditorModelOrigins()
})
