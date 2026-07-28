import { z } from 'zod'

import { matcher } from '@/lib/config/utils'
import { MAX_FILE_SIZE } from '@/lib/services/medias/constants'
import { logger } from '@/lib/utils/logger'

export enum MediaStorageType {
  LocalFile = 'fs',
  ObjectStorage = 'object',
  S3Storage = 's3'
}

export const BaseStorageConfig = z.object({
  maxFileSize: z.number().nullish(),
  quotaPerAccount: z.number().nullish()
})
export type BaseStorageConfig = z.infer<typeof BaseStorageConfig>

export const MediaStorageFileConfig = BaseStorageConfig.extend({
  type: z.literal(MediaStorageType.LocalFile),
  path: z.string()
})
export type MediaStorageFileConfig = z.infer<typeof MediaStorageFileConfig>

export const MediaStorageS3Config = BaseStorageConfig.extend({
  type: z.union([
    z.literal(MediaStorageType.ObjectStorage),
    z.literal(MediaStorageType.S3Storage)
  ]),
  bucket: z.string(),
  region: z.string(),
  hostname: z.string().optional(),
  endpoint: z.string().optional()
})
export type MediaStorageS3Config = z.infer<typeof MediaStorageS3Config>

export const MediaStorageConfig = z.union([
  MediaStorageFileConfig,
  MediaStorageS3Config
])
export type MediaStorageConfig = z.infer<typeof MediaStorageConfig>

// A blank required value is worse than a missing one. Missing fails
// `Config.parse` loudly (`z.string()` rejects `undefined`), while `NAME=`
// satisfies it and boots a live-but-broken backend: an empty `PATH` resolves to
// the process CWD, so uploads land in the application directory and
// /api/v1/files serves it. Treat blank as unset, and say so.
//
// Shared with getFitnessStorageConfig, which falls back to these same
// ACTIVITIES_MEDIA_STORAGE_* variables and would otherwise still root a
// filesystem backend at the CWD from exactly the value rejected here.
export const requiredStorageValue = (
  name: string,
  value: string | undefined,
  subject: string
): string | null | undefined => {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed) return trimmed

  logger.warn(`${name} is set but empty; ${subject} will be disabled`)
  return null
}

export const getMediaStorageConfig = (): {
  mediaStorage: MediaStorageConfig
} | null => {
  const hasEnvironmentMediaStorage = matcher('ACTIVITIES_MEDIA_STORAGE_')
  if (!hasEnvironmentMediaStorage) return null

  switch (process.env.ACTIVITIES_MEDIA_STORAGE_TYPE) {
    case MediaStorageType.LocalFile: {
      const path = requiredStorageValue(
        'ACTIVITIES_MEDIA_STORAGE_PATH',
        process.env.ACTIVITIES_MEDIA_STORAGE_PATH,
        'media storage'
      )
      if (path === null) return null
      return {
        mediaStorage: {
          type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
          path: path as string,
          maxFileSize:
            (process.env.ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE &&
              parseInt(
                process.env.ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE,
                10
              )) ||
            MAX_FILE_SIZE,
          quotaPerAccount:
            (process.env.ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT &&
              parseInt(
                process.env.ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT,
                10
              )) ||
            undefined
        }
      }
    }
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      const bucket = requiredStorageValue(
        'ACTIVITIES_MEDIA_STORAGE_BUCKET',
        process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET,
        'media storage'
      )
      const region = requiredStorageValue(
        'ACTIVITIES_MEDIA_STORAGE_REGION',
        process.env.ACTIVITIES_MEDIA_STORAGE_REGION,
        'media storage'
      )
      if (bucket === null || region === null) return null
      return {
        mediaStorage: {
          type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
          bucket: bucket as string,
          region: region as string,
          hostname: process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME || undefined,
          endpoint: process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT || undefined,
          maxFileSize:
            (process.env.ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE &&
              parseInt(
                process.env.ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE,
                10
              )) ||
            MAX_FILE_SIZE,
          quotaPerAccount:
            (process.env.ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT &&
              parseInt(
                process.env.ACTIVITIES_MEDIA_STORAGE_QUOTA_PER_ACCOUNT,
                10
              )) ||
            undefined
        }
      }
    }
    default:
      return null
  }
}
