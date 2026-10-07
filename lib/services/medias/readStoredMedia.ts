import sharp from 'sharp'

import { Database } from '@/lib/database/types'
import { getMedia } from '@/lib/services/medias'
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

/**
 * The mime type of the bytes themselves. `medias.original.mimeType` records the
 * type of the file that was UPLOADED, not the encoding it was stored as (every
 * image is re-encoded), so it cannot label what is read back.
 */
const sniffImageMimeType = async (buffer: Buffer): Promise<string> => {
  try {
    const { format } = await sharp(buffer).metadata()
    if (format) return `image/${format}`
  } catch {
    // Not an image sharp can read; the caller's vision backend will say so.
  }
  return 'image/jpeg'
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
