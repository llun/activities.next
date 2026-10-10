import { MAX_SOURCE_PIXELS } from '@/lib/services/medias/edit/recipe'
import type { Media } from '@/lib/types/database/operations'

export const EDITABLE_MEDIA_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp'
]

export const MEDIA_NOT_EDITABLE_ERROR = "This media can't be edited"

/**
 * Whether the photo editor may edit this media: a still image the instance
 * stored itself (JPEG, PNG or WebP — never a GIF, video or audio), whose
 * upload has finished, and small enough for the browser to render, going by
 * the size its row records. The routes check the size again against the
 * decoded source (`readEditSource`), since the recorded one may describe the
 * uploaded file rather than the stored one.
 */
export const isEditableMedia = (media: Pick<Media, 'original'>): boolean => {
  const { mimeType, metaData } = media.original
  if (!EDITABLE_MEDIA_TYPES.includes(mimeType)) return false
  if (metaData?.upload?.state === 'pending') return false
  const width = Number(metaData?.width ?? 0)
  const height = Number(metaData?.height ?? 0)
  return width * height <= MAX_SOURCE_PIXELS
}
