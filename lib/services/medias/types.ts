import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { Actor } from '@/lib/types/domain/actor'

import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_SIZE,
  MAX_MEDIA_DESCRIPTION_LENGTH
} from './constants'

const FILE_TYPE_ERROR_MESSAGE = `Only ${ACCEPTED_FILE_TYPES.join(',')} are accepted`
const FILE_SIZE_ERROR_MESSAGE = 'File is larger than the limit.'

export const FileSchema = z
  // Enforce a real File first — z.custom with no guard accepts anything, so a
  // crafted JSON object like { size, type } would otherwise satisfy the refines
  // below and crash later when File methods (arrayBuffer) are called.
  .custom<File>((value) => value instanceof File, 'Expected a file upload')
  .refine((file) => {
    const config = getConfig()
    return file.size <= (config.mediaStorage?.maxFileSize ?? MAX_FILE_SIZE)
  }, FILE_SIZE_ERROR_MESSAGE)
  .refine(
    (file) => ACCEPTED_FILE_TYPES.includes(file.type),
    FILE_TYPE_ERROR_MESSAGE
  )
export type FileSchema = z.infer<typeof FileSchema>

// Mastodon's `focus` parameter: two comma-delimited floats "x,y", each in
// [-1.0, 1.0]. Parses the wire string into the stored { x, y } shape and rejects
// malformed input (wrong arity, non-numeric, or out of range) so routes can
// return 422. See https://docs.joinmastodon.org/methods/media/#focal-points
export const FocusSchema = z
  .string()
  .transform((value) => value.split(','))
  .refine(
    (parts) =>
      parts.length === 2 &&
      parts.every((part) => {
        // Reject empty/whitespace axes — Number('') is 0, which would otherwise
        // sneak "0.5," through as { x: 0.5, y: 0 }.
        if (part.trim() === '') return false
        const value = Number(part)
        return Number.isFinite(value) && value >= -1 && value <= 1
      }),
    'Focus must be two comma-separated floats in the range -1.0 to 1.0'
  )
  .transform((parts) => ({ x: Number(parts[0]), y: Number(parts[1]) }))
export type FocusSchema = z.infer<typeof FocusSchema>

export const MediaSchema = z.object({
  file: FileSchema,
  thumbnail: FileSchema.optional(),
  // Mastodon's alt-text limit. The column is `text`, so this cap is API
  // compatibility, not a storage constraint. Empty/whitespace-only alt text is
  // normalised to null so the upload path clears the description the same way
  // the update path (UpdateMediaRequest) does. `.optional()` stays OUTERMOST so
  // an omitted field remains an optional key (callers construct MediaSchema
  // values without a description); a present-but-blank value becomes null.
  description: z
    .string()
    .max(MAX_MEDIA_DESCRIPTION_LENGTH)
    .nullable()
    .transform((value) => (value && value.trim() ? value : null))
    .optional(),
  focus: FocusSchema.optional()
})
export type MediaSchema = z.infer<typeof MediaSchema>

const MediaMeta = z.object({
  width: z.number(),
  height: z.number(),
  size: z.string().regex(/^\d+x\d+$/),
  aspect: z.number()
})
type MediaMeta = z.infer<typeof MediaMeta>

// Mastodon MediaAttachment `type` values. We currently produce image/video/
// audio from stored mime types and fall back to `unknown`; `gifv` is part of the
// Mastodon vocabulary but is not generated here (we don't transcode GIFs).
// https://docs.joinmastodon.org/entities/MediaAttachment/#type
export const MediaType = z.enum(['image', 'gifv', 'video', 'audio', 'unknown'])
export type MediaType = z.infer<typeof MediaType>

export const MediaStorageSaveFileOutput = z.object({
  id: z.string(),
  type: MediaType,
  mime_type: z.string(),
  url: z.string().url(),
  preview_url: z.string().url().nullish(),
  text_url: z.string().url().nullish(),
  remote_url: z.string().url().nullish(),
  preview_remote_url: z.string().url().nullish(),
  meta: z.object({
    original: MediaMeta,
    small: MediaMeta.optional(),
    focus: z.object({ x: z.number(), y: z.number() }).optional()
  }),
  // Alt text. Mastodon serialises "no description" as null, never ''.
  description: z.string().nullable(),
  // BlurHash for blurred placeholders. We do not compute it yet, so it is always
  // null, but the field is always present to match Mastodon's serializer.
  blurhash: z.string().nullable()
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
  checksum: z
    .string()
    .regex(/^[a-f0-9]{40}$/i)
    .transform((value) => value.toLowerCase()),
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
  saveFileOutput: MediaStorageSaveFileOutput,
  headers: z.record(z.string(), z.string()).optional()
})
export type PresignedUrlOutput = z.infer<typeof PresignedUrlOutput>

// A processed thumbnail ready to persist on an existing media row. Mirrors the
// `thumbnail` shape `createMedia`/`updateMedia` accept.
export interface ThumbnailStorageOutput {
  path: string
  bytes: number
  mimeType: string
  metaData: { width: number; height: number }
}

export interface MediaStorage {
  isPresigedSupported(): boolean
  saveFile(
    actor: Actor,
    media: MediaSchema
  ): Promise<MediaStorageSaveFileOutput | null>
  // Processes and stores a standalone thumbnail image (used by PUT/PATCH
  // /api/v1/media/:id to replace a custom thumbnail). Enforces the account
  // storage quota (throws MediaValidationError when exceeded) and returns null
  // for non-image input.
  saveThumbnail(
    actor: Actor,
    file: File
  ): Promise<ThumbnailStorageOutput | null>
  getPresigedForSaveFileUrl(
    actor: Actor,
    media: PresigedMediaInput
  ): Promise<PresignedUrlOutput | null>
  completePresignedUpload(
    actor: Actor,
    mediaId: string
  ): Promise<MediaStorageSaveFileOutput | null>
  getFile(
    filePath: string
  ): Promise<MediaStorageGetFileOutput | MediaStorageGetRedirectOutput | null>
  deleteFile(filePath: string): Promise<boolean>
}
