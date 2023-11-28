import { z } from 'zod'

import { matcher } from './utils'

export enum MediaStorageType {
  LocalFile = 'fs',
  ObjectStorage = 'object'
}

export const MediaStorageConfig = z.union([
  z.object({
    type: z.literal(MediaStorageType.LocalFile),
    path: z.string()
  }),
  z.object({
    type: z.literal(MediaStorageType.ObjectStorage),
    bucket: z.string()
  })
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
          bucket: process.env.ACTIVITIES_MEDIA_STORAGE_BUCKET as string
        }
      }
    }
    default:
      return null
  }
}
