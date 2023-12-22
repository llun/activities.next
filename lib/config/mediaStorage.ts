import { z } from 'zod'

import { matcher } from '@/lib/config/utils'

export enum MediaStorageType {
  LocalFile = 'fs',
  ObjectStorage = 'object'
}

export const MediaStorageFileConfig = z.object({
  type: z.literal(MediaStorageType.LocalFile),
  path: z.string()
})
export type MediaStorageFileConfig = z.infer<typeof MediaStorageFileConfig>

export const MediaStorageObjectConfig = z.object({
  type: z.literal(MediaStorageType.ObjectStorage),
  bucket: z.string(),
  region: z.string(),
  hostname: z.string().optional()
})
export type MediaStorageObjectConfig = z.infer<typeof MediaStorageObjectConfig>

export const MediaStorageConfig = z.union([
  MediaStorageFileConfig,
  MediaStorageObjectConfig
])
export type MediaStorageConfig = z.infer<typeof MediaStorageConfig>

export const getMediaStorageConfig = (): {
  mediaStorage: MediaStorageConfig
} | null => {
  const hasEnvironmentOtel = matcher('ACTIVITIES_MEDIA_STORAGE_')
  if (!hasEnvironmentOtel) return null

  switch (process.env.ACTIVITIES_MEDIA_STORAGE_TYPE) {
    case MediaStorageType.LocalFile:
      return {
        mediaStorage: {
          type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
          path: process.env.ACTIVITIES_MEDIA_STORAGE_PATH as string
        }
      }
    case MediaStorageType.ObjectStorage: {
      return {
        mediaStorage: {
          type: process.env.ACTIVITIES_MEDIA_STORAGE_TYPE,
          bucket: process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET as string,
          region: process.env.ACTIVITIES_MEDIA_STORAGE_REGION as string,
          hostname:
            (process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME as string) ?? ''
        }
      }
    }
    default:
      return null
  }
}
