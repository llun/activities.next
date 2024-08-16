import { z } from 'zod'

import { getConfig } from '@/lib/config'

import { Actor } from '../../models/actor'
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

const MediaMeta = z.object({
  width: z.number(),
  height: z.number(),
  size: z.string().regex(/^\d+x\d+$/),
  aspect: z.number()
})
type MediaMeta = z.infer<typeof MediaMeta>

export const MediaType = z.enum(['image', 'video'])
export type MediaType = z.infer<typeof MediaType>

export const MediaStorageSaveFileOutput = z.object({
  id: z.string(),
  type: MediaType,
  mime_type: z.string(),
  url: z.string().url(),
  preview_url: z.string().url(),
  text_url: z.string().url().nullish(),
  remote_url: z.string().url().nullish(),
  meta: z.object({
    original: MediaMeta,
    small: MediaMeta.optional()
  }),
  description: z.string()
})
export type MediaStorageSaveFileOutput = z.infer<
  typeof MediaStorageSaveFileOutput
>

export const MediaStorageGetFileOutput = z.object({
  type: z.literal('buffer'),
  buffer: z.instanceof(Buffer),
  contentType: z.string()
})
export type MediaStorageGetFileOutput = z.infer<
  typeof MediaStorageGetFileOutput
>

export const MediaStorageGetRedirectOutput = z.object({
  type: z.literal('redirect'),
  redirectUrl: z.string().url()
})
export type MediaStorageGetRedirectOutput = z.infer<
  typeof MediaStorageGetRedirectOutput
>

export interface MediaStorage {
  saveFile: (
    actor: Actor,
    media: MediaSchema
  ) => Promise<MediaStorageSaveFileOutput | null>
  getFile: (
    filePath: string
  ) => Promise<MediaStorageGetFileOutput | MediaStorageGetRedirectOutput | null>
}
