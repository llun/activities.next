import { z } from 'zod'

import { requiredStorageValue } from '@/lib/config/storageValue'
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

export const getMediaStorageConfig = (): {
  mediaStorage: MediaStorageConfig
} | null => {
  const hasEnvironmentMediaStorage = matcher('ACTIVITIES_MEDIA_STORAGE_')
  if (!hasEnvironmentMediaStorage) return null

  switch (process.env.ACTIVITIES_MEDIA_STORAGE_TYPE) {
    case MediaStorageType.LocalFile: {
      const storagePath = requiredStorageValue(
        'ACTIVITIES_MEDIA_STORAGE_PATH',
        'media storage'
      )
      if (storagePath === null) return null
      return {
        mediaStorage: {
          type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
          // An unset path stays `undefined` on purpose so `Config.parse` keeps
          // rejecting it loudly; only a blank one is handled above.
          path: storagePath as string,
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
        'media storage'
      )
      const region = requiredStorageValue(
        'ACTIVITIES_MEDIA_STORAGE_REGION',
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
      // Reached only when some ACTIVITIES_MEDIA_STORAGE_* variable is set, so
      // the operator meant to configure storage. Disabling it silently is the
      // same failure mode as a blank required value. Mirrors lib/config/email.ts.
      if (process.env.ACTIVITIES_MEDIA_STORAGE_TYPE) {
        logger.warn(
          `Unknown ACTIVITIES_MEDIA_STORAGE_TYPE value "${process.env.ACTIVITIES_MEDIA_STORAGE_TYPE}"; media storage will be disabled`
        )
      } else {
        logger.warn(
          'ACTIVITIES_MEDIA_STORAGE_TYPE is not set; media storage will be disabled'
        )
      }
      return null
  }
}
