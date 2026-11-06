// Decides where a shared payload goes. The rules are deterministic: a workout
// file is recognised by extension first (some Android apps send `.gpx`/`.tcx`
// as `application/octet-stream`), then by MIME type; media by the composer's
// accepted types; everything else is skipped with a reason.
import {
  ACCEPTED_FITNESS_FILE_EXTENSIONS,
  ACCEPTED_FITNESS_FILE_TYPES
} from '@/lib/services/fitness-files/constants'
import { ACCEPTED_FILE_TYPES } from '@/lib/services/medias/constants'

export interface ShareTargetLimits {
  /** Resolved `media.maxFileSize`. */
  maxMediaFileSize: number
  /** Resolved fitness storage limit (50 MiB by default). */
  maxFitnessFileSize: number
  /** Resolved `posts.maxMediaAttachments`. */
  maxMediaAttachments: number
}

export interface ShareTargetSkipSummary {
  /** A type the composer cannot attach (e.g. HEIC). */
  unsupported: number
  /** Over the media or fitness size limit. */
  tooLarge: number
  /** Over the attachment cap for the destination. */
  overLimit: number
}

export type ShareTargetPlan =
  | {
      kind: 'composer'
      media: File[]
      fitnessFile?: File
      skipped: ShareTargetSkipSummary
    }
  | {
      kind: 'import'
      fitnessFiles: File[]
      skippedMedia: number
      skipped: ShareTargetSkipSummary
    }
  | { kind: 'empty'; skipped: ShareTargetSkipSummary }

const emptySkips = (): ShareTargetSkipSummary => ({
  unsupported: 0,
  tooLarge: 0,
  overLimit: 0
})

const hasFitnessExtension = (name: string) => {
  const lower = name.toLowerCase()
  return ACCEPTED_FITNESS_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export const isFitnessShareFile = (file: File): boolean =>
  hasFitnessExtension(file.name) ||
  ACCEPTED_FITNESS_FILE_TYPES.includes(file.type)

export const isMediaShareFile = (file: File): boolean =>
  ACCEPTED_FILE_TYPES.includes(file.type)

/** The media slots a composer has left when a workout is attached. */
export const getMediaAttachmentCap = (
  maxMediaAttachments: number,
  hasFitnessFile: boolean
): number =>
  hasFitnessFile
    ? Math.max(0, maxMediaAttachments - 1)
    : Math.max(0, maxMediaAttachments)

export const classifySharedFiles = (
  files: File[],
  limits: ShareTargetLimits
): ShareTargetPlan => {
  const skipped = emptySkips()
  const fitnessFiles: File[] = []
  const mediaFiles: File[] = []

  for (const file of files) {
    if (isFitnessShareFile(file)) {
      if (file.size > limits.maxFitnessFileSize) {
        skipped.tooLarge += 1
        continue
      }
      fitnessFiles.push(file)
      continue
    }
    if (isMediaShareFile(file)) {
      if (file.size > limits.maxMediaFileSize) {
        skipped.tooLarge += 1
        continue
      }
      mediaFiles.push(file)
      continue
    }
    skipped.unsupported += 1
  }

  if (fitnessFiles.length >= 2) {
    // Batch import cannot carry photos: they are reported, not silently lost.
    return {
      kind: 'import',
      fitnessFiles,
      skippedMedia: mediaFiles.length,
      skipped
    }
  }

  const fitnessFile = fitnessFiles[0]
  const cap = getMediaAttachmentCap(
    limits.maxMediaAttachments,
    Boolean(fitnessFile)
  )
  const media = mediaFiles.slice(0, cap)
  skipped.overLimit += mediaFiles.length - media.length

  if (!fitnessFile && media.length === 0) {
    return { kind: 'empty', skipped }
  }

  return { kind: 'composer', media, fitnessFile, skipped }
}

export const hasSkippedFiles = (skipped: ShareTargetSkipSummary): boolean =>
  skipped.unsupported + skipped.tooLarge + skipped.overLimit > 0

/** One sentence naming how many files were skipped and why. */
export const describeSkippedFiles = (
  skipped: ShareTargetSkipSummary
): string | null => {
  const reasons: string[] = []
  if (skipped.unsupported > 0) {
    reasons.push(
      `${skipped.unsupported} ${skipped.unsupported === 1 ? 'file has a type' : 'files have types'} the composer can't attach`
    )
  }
  if (skipped.tooLarge > 0) {
    reasons.push(
      `${skipped.tooLarge} ${skipped.tooLarge === 1 ? 'file is' : 'files are'} over the size limit`
    )
  }
  if (skipped.overLimit > 0) {
    reasons.push(
      `${skipped.overLimit} ${skipped.overLimit === 1 ? 'file was' : 'files were'} over the attachment limit`
    )
  }
  if (reasons.length === 0) return null
  const total = skipped.unsupported + skipped.tooLarge + skipped.overLimit
  return `${total} shared ${total === 1 ? 'file was' : 'files were'} skipped: ${reasons.join('; ')}.`
}
