import { z } from 'zod'

import { getConfig } from '@/lib/config'

import { Actor } from '../../models/actor'
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE } from './constants'

const FILE_TYPE_ERROR_MESSAGE = `Only ${ACCEPTED_FILE_TYPES.join(',')} are accepted`
const FILE_SIZE_ERROR_MESSAGE = 'File is larger than the limit.'

export const FileSchema = z
  .custom<File>()
  .refine((file) => {
    const config = getConfig()
    return file.size <= (config.mediaStorage?.maxFileSize ?? MAX_FILE_SIZE)
  }, FILE_SIZE_ERROR_MESSAGE)
  .refine(
    (file) => ACCEPTED_FILE_TYPES.includes(file.type),
    FILE_TYPE_ERROR_MESSAGE
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
  preview_url: z.string().url().nullish(),
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

export const PresigedMediaInput = z.object({
  fileName: z.string(),
  checksum: z.string(),
  width: z.number(),
  height: z.number(),
  contentType: z
    .string()
    .refine(
      (value) => ACCEPTED_FILE_TYPES.includes(value),
      FILE_TYPE_ERROR_MESSAGE
    ),
  size: z.number().refine((value) => {
    const config = getConfig()
    return value <= (config.mediaStorage?.maxFileSize ?? MAX_FILE_SIZE)
  }, FILE_SIZE_ERROR_MESSAGE)
})
export type PresigedMediaInput = z.infer<typeof PresigedMediaInput>

export const PresignedUrlOutput = z.object({
  url: z.string().url(),
  fields: z.record(z.string(), z.string()),
  saveFileOutput: MediaStorageSaveFileOutput
})
export type PresignedUrlOutput = z.infer<typeof PresignedUrlOutput>

export interface MediaStorage {
  isPresigedSupported(): boolean
  saveFile(
    actor: Actor,
    media: MediaSchema
  ): Promise<MediaStorageSaveFileOutput | null>
  getPresigedForSaveFileUrl(
    actor: Actor,
    media: PresigedMediaInput
  ): Promise<PresignedUrlOutput | null>
  getFile(
    filePath: string
  ): Promise<MediaStorageGetFileOutput | MediaStorageGetRedirectOutput | null>
  deleteFile(filePath: string): Promise<boolean>
}
