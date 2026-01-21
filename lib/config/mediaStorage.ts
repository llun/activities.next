import { z } from 'zod'

import { matcher } from '@/lib/config/utils'
import { MAX_FILE_SIZE } from '@/lib/services/medias/constants'

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
  hostname: z.string().optional()
})
export type MediaStorageS3Config = z.infer<typeof MediaStorageS3Config>

export const MediaStorageConfig = z.union([
  MediaStorageFileConfig,
  MediaStorageS3Config
])
export type MediaStorageConfig = z.infer<typeof MediaStorageConfig>

export const getMediaStorageConfig = (): {
  mediaStorage: MediaStorageConfig
} | null => {
  const hasEnvironmentMediaStorage = matcher('ACTIVITIES_MEDIA_STORAGE_')
  if (!hasEnvironmentMediaStorage) return null

  switch (process.env.ACTIVITIES_MEDIA_STORAGE_TYPE) {
    case MediaStorageType.LocalFile:
      return {
        mediaStorage: {
          type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
          path: process.env.ACTIVITIES_MEDIA_STORAGE_PATH as string,
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
    case MediaStorageType.S3Storage:
    case MediaStorageType.ObjectStorage: {
      return {
        mediaStorage: {
          type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
          bucket: process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET as string,
          region: process.env.ACTIVITIES_MEDIA_STORAGE_REGION as string,
          hostname:
            (process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME as string) ?? '',
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
