import { z } from 'zod'

import { MediaStorageConfig } from '../../config/mediaStorage'
import { Actor } from '../../models/actor'
import { Storage } from '../../storage/types'

// Maximum file size is 10 MB
export const MAX_FILE_SIZE = 10_485_760
export const MAX_WIDTH = 2048
export const MAX_HEIGHT = 2048
export const ACCEPTED_FILE_TYPES = [
  'image/jpg',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'video/mp4',
  'audio/mp4'
]

export const FileSchema = z
  .custom<File>()
  .refine(
    (file) => file.size <= MAX_FILE_SIZE,
    `Max file size is ${MAX_FILE_SIZE} bytes.`
  )
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
  buffer: Buffer
  contentType: string
}

export type MediaStorageGetFile = (
  config: MediaStorageConfig,
  filePath: string
) => Promise<MediaStorageGetFileOutput | null>
