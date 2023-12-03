import { z } from 'zod'

// Maximum file size is 1 MB
export const MAX_FILE_SIZE = 1_048_576
export const ACCEPTED_FILE_TYPES = [
  'image/jpg',
  'image/png',
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
