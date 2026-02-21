import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { DEFAULT_FITNESS_MAX_FILE_SIZE } from '@/lib/config/fitnessStorage'
import { Actor } from '@/lib/types/domain/actor'

import {
  ACCEPTED_FITNESS_FILE_EXTENSIONS,
  ACCEPTED_FITNESS_FILE_TYPES
} from './constants'

const FILE_TYPE_ERROR_MESSAGE = `Only ${ACCEPTED_FITNESS_FILE_TYPES.join(',')} are accepted`
const FILE_SIZE_ERROR_MESSAGE = 'File is larger than the limit.'

export const FitnessFileSchema = z
  .custom<File>()
  .refine((file) => {
    const config = getConfig()
    const maxSize =
      config.fitnessStorage?.maxFileSize ?? DEFAULT_FITNESS_MAX_FILE_SIZE
    return file.size <= maxSize
  }, FILE_SIZE_ERROR_MESSAGE)
  .refine((file) => {
    const lowerName = file.name.toLowerCase()
    const hasValidExtension = ACCEPTED_FITNESS_FILE_EXTENSIONS.some((ext) =>
      lowerName.endsWith(ext)
    )

    // Always require a known fitness file extension.
    if (!hasValidExtension) {
      return false
    }

    // Allow generic binary uploads only for .fit files.
    if (file.type === 'application/octet-stream') {
      return lowerName.endsWith('.fit')
    }

    // Some browsers omit file.type for uncommon uploads; rely on extension.
    if (!file.type) {
      return true
    }

    return ACCEPTED_FITNESS_FILE_TYPES.includes(file.type)
  }, FILE_TYPE_ERROR_MESSAGE)

export type FitnessFileSchema = z.infer<typeof FitnessFileSchema>

export const FitnessFileUploadSchema = z.object({
  file: FitnessFileSchema,
  description: z.string().optional(),
  importBatchId: z.string().optional()
})
export type FitnessFileUploadSchema = z.infer<typeof FitnessFileUploadSchema>

export const FitnessStorageSaveFileOutput = z.object({
  id: z.string(),
  type: z.literal('fitness'),
  file_type: z.enum(['fit', 'gpx', 'tcx']),
  mime_type: z.string(),
  url: z.string().url(),
  fileName: z.string(),
  size: z.number(),
  description: z.string().optional(),
  // Optional map data
  hasMapData: z.boolean().optional(),
  mapImageUrl: z.string().url().optional()
})
export type FitnessStorageSaveFileOutput = z.infer<
  typeof FitnessStorageSaveFileOutput
>

export const FitnessStorageGetFileOutput = z.object({
  type: z.literal('buffer'),
  buffer: z.instanceof(Buffer),
  contentType: z.string()
})
export type FitnessStorageGetFileOutput = z.infer<
  typeof FitnessStorageGetFileOutput
>

export const FitnessStorageGetRedirectOutput = z.object({
  type: z.literal('redirect'),
  redirectUrl: z.string().url()
})
export type FitnessStorageGetRedirectOutput = z.infer<
  typeof FitnessStorageGetRedirectOutput
>

export interface FitnessStorage {
  saveFile(
    actor: Actor,
    fitnessFile: FitnessFileUploadSchema
  ): Promise<FitnessStorageSaveFileOutput | null>
  getFile(
    filePath: string
  ): Promise<
    FitnessStorageGetFileOutput | FitnessStorageGetRedirectOutput | null
  >
  deleteFile(filePath: string): Promise<boolean>
}

// Helper to determine file type from filename or mime type
export function getFitnessFileType(
  fileName: string,
  mimeType: string
): 'fit' | 'gpx' | 'tcx' {
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.fit') || mimeType.includes('fit')) {
    return 'fit'
  } else if (lowerName.endsWith('.gpx') || mimeType.includes('gpx')) {
    return 'gpx'
  } else if (lowerName.endsWith('.tcx') || mimeType.includes('tcx')) {
    return 'tcx'
  }

  throw new Error(
    `Unable to determine fitness file type for ${fileName} (${mimeType})`
  )
}
