import sharp from 'sharp'

import { Database } from '@/lib/database/types'
import { getMedia } from '@/lib/services/medias'
import { MAX_IMAGE_INPUT_PIXELS } from '@/lib/services/medias/constants'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'
import { readResponseArrayBufferWithLimit } from '@/lib/utils/streamLimit'

// A stored rendition is capped at 4000px and re-encoded, so a few MiB at most;
// an S3 original uploaded through a presigned URL is the client's own bytes and
// can be larger, which is what the cap is for.
export const STORED_MEDIA_READ_MAX_BYTES = 25 * 1024 * 1024

const FETCH_HOP_TIMEOUT_MS = 15_000
const FETCH_TOTAL_TIMEOUT_MS = 60_000

export interface StoredImage {
  buffer: Buffer
  mimeType: string
}

const ACCEPTED_SNIFFED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif'])

/**
 * The mime type of the bytes themselves. `medias.original.mimeType` records the
 * type of the file that was UPLOADED, not the encoding it was stored as (every
 * image is re-encoded), so it cannot label what is read back. Only the formats
 * this instance accepts are named; anything else is `application/octet-stream`.
 */
const sniffImageMimeType = async (buffer: Buffer): Promise<string> => {
  try {
    const { format, compression } = await sharp(buffer, {
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS
    }).metadata()
    // HEIF is a container: only AV1-compressed AVIF is an accepted image. An
    // HEVC/HEIC file must not be labelled `image/avif` and handed to a vision
    // backend as one.
    if (format === 'heif') {
      return compression === 'av1' ? 'image/avif' : 'application/octet-stream'
    }
    if (format && ACCEPTED_SNIFFED_FORMATS.has(format)) return `image/${format}`
  } catch {
    // Not an image sharp can read; the caller's vision backend will say so.
  }
  return 'application/octet-stream'
}

/**
 * Reads a stored image back through the configured storage driver, bounded by
 * `maxBytes`. Local files and S3 objects are streamed; a storage with a public
 * hostname answers with a redirect, which is followed through the guarded
 * binary fetch. Returns null when the path is unknown or unreachable.
 */
export const readStoredImage = async (
  database: Database,
  path: string,
  maxBytes = STORED_MEDIA_READ_MAX_BYTES
): Promise<StoredImage | null> => {
  const file = await getMedia(database, path)
  if (!file) return null

  let bytes: ArrayBuffer
  if (file.type === 'stream') {
    bytes = await readResponseArrayBufferWithLimit(
      new Response(file.stream),
      maxBytes,
      'Stored media'
    )
  } else {
    const response = await safeImageFetch(file.redirectUrl, {
      timeoutMs: FETCH_HOP_TIMEOUT_MS,
      signal: AbortSignal.timeout(FETCH_TOTAL_TIMEOUT_MS)
    })
    if (!response?.ok) return null
    bytes = await readResponseArrayBufferWithLimit(
      response,
      maxBytes,
      'Stored media'
    )
  }

  const buffer = Buffer.from(bytes)
  return { buffer, mimeType: await sniffImageMimeType(buffer) }
}
