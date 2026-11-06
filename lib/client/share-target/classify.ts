// Decides where a shared payload goes. The rules are deterministic: a workout
// file is recognised by its extension alone, as the upload route requires one
// (some Android apps send `.gpx`/`.tcx` as `application/octet-stream`, and a
// bare `text/xml` is not a workout); media by the composer's accepted types;
// everything else is skipped with a reason.
import { ACCEPTED_FITNESS_FILE_EXTENSIONS } from '@/lib/services/fitness-files/constants'
import { ACCEPTED_FILE_TYPES } from '@/lib/services/medias/constants'
import { formatFileSize } from '@/lib/utils/formatFileSize'

import { SHARE_TARGET_MAX_FILES, SHARE_TARGET_MAX_TOTAL_BYTES } from './types'

export interface ShareTargetLimits {
  /** Resolved `media.maxFileSize`. */
  maxMediaFileSize: number
  /** Resolved fitness storage limit (50 MiB by default). */
  maxFitnessFileSize: number
  /** Resolved `posts.maxMediaAttachments`. */
  maxMediaAttachments: number
  /** Whether this instance takes media uploads; off, shared media is skipped. */
  isMediaUploadEnabled: boolean
}

export interface ShareTargetSkipSummary {
  /** A type the composer cannot attach (e.g. HEIC). */
  unsupported: number
  /** Over the media or fitness size limit. */
  tooLarge: number
  /** Over the attachment cap for the destination. */
  overLimit: number
  /** Media, while this instance takes no media uploads. */
  uploadsOff: number
  /** Refused by the worker: past 20 files or the 250 MiB share budget. */
  notStaged: number
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
  overLimit: 0,
  uploadsOff: 0,
  notStaged: 0
})

const hasFitnessExtension = (name: string) => {
  const lower = name.toLowerCase()
  return ACCEPTED_FITNESS_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export const isFitnessShareFile = (file: File): boolean =>
  hasFitnessExtension(file.name)

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
  limits: ShareTargetLimits,
  /** `StagedShare.skipped`: files the worker never staged. */
  notStaged = 0
): ShareTargetPlan => {
  const skipped = { ...emptySkips(), notStaged }
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
      if (!limits.isMediaUploadEnabled) {
        skipped.uploadsOff += 1
        continue
      }
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

/**
 * The files the worker never staged (`StagedShare.skipped`), in the words both
 * the /app card and the batch importer use.
 */
export const describeNotStaged = (count: number): string =>
  // formatFileSize is the house unit for user copy (1024-based, written "MB").
  `${count} ${count === 1 ? 'file was' : 'files were'} past the share limit of ${SHARE_TARGET_MAX_FILES} files and ${formatFileSize(SHARE_TARGET_MAX_TOTAL_BYTES)}`

const totalSkipped = (skipped: ShareTargetSkipSummary) =>
  skipped.unsupported +
  skipped.tooLarge +
  skipped.overLimit +
  skipped.uploadsOff +
  skipped.notStaged

export const hasSkippedFiles = (skipped: ShareTargetSkipSummary): boolean =>
  totalSkipped(skipped) > 0

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** Whether shared text is a bare link (the usual browser "Share" of a page). */
export const isSharedLink = (text: string): boolean =>
  /^https?:\/\/\S+$/i.test(text.trim())

/**
 * The text a share carries, as one composer string: the title, the text and
 * the link on their own lines, leaving out a title or link the text already
 * contains (browsers often send the page URL in both `text` and `url`).
 */
export const joinSharedText = ({
  title,
  text,
  url
}: {
  title?: string
  text?: string
  url?: string
}): string => {
  const body = text?.trim() ?? ''
  const heading = title?.trim() ?? ''
  const link = url?.trim() ?? ''
  return [
    heading && !body.includes(heading) ? heading : '',
    body,
    link && !body.includes(link) ? link : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * "2 photos, 1 video and 1 workout were shared", "A link was shared", for the
 * confirmation.
 */
export const describeSharedFiles = (
  media: File[],
  fitnessFile?: File,
  text = '',
  // A share whose only text is a link, with or without the page title.
  isLink = isSharedLink(text)
): string => {
  const videos = media.filter((file) => file.type.startsWith('video/')).length
  const photos = media.length - videos
  const parts: string[] = []
  if (photos > 0) parts.push(count(photos, 'photo', 'photos'))
  if (videos > 0) parts.push(count(videos, 'video', 'videos'))
  if (fitnessFile) parts.push('1 workout')
  if (text) parts.push(isLink ? 'a link' : 'some text')
  const list =
    parts.length > 1
      ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
      : (parts[0] ?? 'nothing')
  const total = media.length + (fitnessFile ? 1 : 0) + (text ? 1 : 0)
  const sentence = `${list} ${total === 1 ? 'was' : 'were'} shared`
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

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
  if (skipped.uploadsOff > 0) {
    reasons.push(
      `${skipped.uploadsOff} ${skipped.uploadsOff === 1 ? 'photo or video' : 'photos or videos'} because this server takes no media uploads`
    )
  }
  if (skipped.notStaged > 0) reasons.push(describeNotStaged(skipped.notStaged))
  if (reasons.length === 0) return null
  const total = totalSkipped(skipped)
  return `${total} shared ${total === 1 ? 'file was' : 'files were'} skipped: ${reasons.join('; ')}.`
}
