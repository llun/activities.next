import sharp from 'sharp'

import { MediaValidationError } from './errors'
import type { MediaSchema } from './types'

// Checks that bytes claiming to be an image actually are one. `metadata()`
// parses the header rather than decoding pixels, so this is cheap enough to run
// before anything is stored — which is the point: an unreadable thumbnail must
// be a 422 rather than a 500 with a stored original left behind, and a failure
// after this point must stay recognisable as a storage failure of ours rather
// than being reported as the caller's fault.
export const assertReadableImageBytes = async (file: File) => {
  try {
    await sharp(Buffer.from(await file.arrayBuffer())).metadata()
  } catch {
    throw new MediaValidationError('Thumbnail is not a readable image')
  }
}

// A thumbnail is unvalidated client input on every path that accepts one:
// `FileSchema` checks the declared type against ACCEPTED_FILE_TYPES, which
// includes video and audio, and a declared type is only a claim in any case.
// Both storage drivers validate it through here so the answer cannot differ by
// backend — that divergence is what this module exists to prevent.
export const assertReadableThumbnail = async (thumbnail: File) => {
  if (!thumbnail.type.startsWith('image')) {
    throw new MediaValidationError('Thumbnail must be an image')
  }
  await assertReadableImageBytes(thumbnail)
}

// `createMedia` meters the original's UPLOADED bytes plus the thumbnail's
// STORED bytes, so this is a best-effort reservation, not an exact one: a lossy
// JPEG can re-encode into a near-lossless WebP larger than it arrived as.
// Reserving nothing was worse — an upload that fits only without its thumbnail
// was accepted and left the account over its quota. The original under-counts
// the same way, and always has.
export const getUploadQuotaReservation = (media: MediaSchema) =>
  media.file.size + (media.thumbnail?.size ?? 0)
