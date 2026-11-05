import sharp from 'sharp'

import { MAX_AVIF_INPUT_PIXELS, MAX_IMAGE_INPUT_PIXELS } from './constants'
import { MediaValidationError } from './errors'

// HEIF is a container: only AV1-compressed AVIF is accepted, never HEVC/HEIC.
const SHARP_FORMAT_BY_IMAGE_TYPE: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'heif'
}

/** Validate the format and total decoded size before any all-frame decode. */
export const readUploadImageMetadata = async (
  input: Buffer | string,
  contentType?: string
) => {
  let metadata
  try {
    metadata = await sharp(input, {
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS
    }).metadata()
  } catch {
    throw new MediaValidationError('Uploaded image is not a readable image')
  }
  const expected = contentType
    ? SHARP_FORMAT_BY_IMAGE_TYPE[contentType]
    : undefined
  if (
    (contentType && (!expected || metadata.format !== expected)) ||
    !Object.values(SHARP_FORMAT_BY_IMAGE_TYPE).includes(
      metadata.format ?? ''
    ) ||
    (metadata.format === 'heif' && metadata.compression !== 'av1')
  ) {
    throw new MediaValidationError(
      'Uploaded image does not match an accepted image type'
    )
  }
  const width = metadata.width ?? 0
  const height = metadata.pageHeight ?? metadata.height ?? 0
  const pages = metadata.pages ?? 1
  if (
    !width ||
    !height ||
    !Number.isSafeInteger(pages) ||
    pages < 1 ||
    width * height * pages > MAX_IMAGE_INPUT_PIXELS
  ) {
    throw new MediaValidationError(
      'Uploaded image exceeds the decoded pixel limit'
    )
  }
  // AVIF cannot shrink-on-load (libheif/libaom decodes the whole frame first),
  // so a single frame gets its own, lower cap. Checked after the shared budget
  // so an oversized AVIF is refused with the same upload error either way.
  if (
    metadata.format === 'heif' &&
    width * height * pages > MAX_AVIF_INPUT_PIXELS
  ) {
    throw new MediaValidationError(
      'Uploaded AVIF image exceeds the decoded pixel limit'
    )
  }
  return metadata
}
