import { z } from 'zod'

import { getConfig } from '@/lib/config'

import { MediaStorageConfig } from '../../config/mediaStorage'
import { Actor } from '../../models/actor'
import { Storage } from '../../storage/types'
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE } from './constants'

export const FileSchema = z
  .custom<File>()
  .refine((file) => {
    const config = getConfig()
    return file.size <= (config.mediaStorage?.maxFileSize ?? MAX_FILE_SIZE)
  }, 'File is larger than the limit.')
  .refine(
    (file) => ACCEPTED_FILE_TYPES.includes(file.type),
    `Only ${ACCEPTED_FILE_TYPES.join(',')} are accepted`
  )
export type FileSchema = z.infer<typeof FileSchema>

export const MediaSchema = z.object({
  file: FileSchema,
  thumbnail: FileSchema.optional(),
  description: z.string().optional()
})
export type MediaSchema = z.infer<typeof MediaSchema>

interface MediaMeta {
  width: number
  height: number
  size: `${number}x${number}`
  aspect: number
}
export interface MediaStorageSaveFileOutput {
  id: string
  type: 'image' | 'video'
  // Non-mastodon property
  mime_type: string
  url: string
  preview_url: string
  text_url: string
  remote_url: string
  meta: {
    original: MediaMeta
    small?: MediaMeta
  }
  description: string
}
export type MediaStorageSaveFile = (
  config: MediaStorageConfig,
  host: string,
  storage: Storage,
  actor: Actor,
  media: MediaSchema
) => Promise<MediaStorageSaveFileOutput | null>

export interface MediaStorageGetFileOutput {
  type: 'buffer'
  buffer: Buffer
  contentType: string
}

export interface MediaStorageGetRedirectOutput {
  type: 'redirect'
  redirectUrl: string
}

export type MediaStorageGetFile = (
  config: MediaStorageConfig,
  filePath: string
) => Promise<MediaStorageGetFileOutput | MediaStorageGetRedirectOutput | null>
