import crypto from 'crypto'
import { tmpdir } from 'os'
import { dirname, extname, join, resolve } from 'path'

import { MediaValidationError } from '@/lib/services/medias/errors'

// Upload file names are attacker-controlled. Only a browser multipart upload is
// guaranteed to send a bare basename; every non-browser client of
// `POST /api/v1/media`, `POST /api/v2/media` and the presigned flow puts an
// arbitrary string in the field. `path.join` resolves `..` segments, so joining
// such a name to a directory walks out of it — `join(tmpdir(), 'deadbeef' +
// '../../../../etc/passwd')` lands outside `tmpdir()` entirely. Everything the
// storage drivers derive from a supplied name goes through this module, so the
// reduction happens once, at the point the name enters storage.

/** Name used when a supplied file name reduces to nothing usable. */
export const FALLBACK_STORED_FILE_NAME = 'file'

// `medias.originalFileName` is `varchar(255)` and most filesystems cap a single
// path segment at 255 bytes, so the stored name is bounded by the tighter of the
// two. 200 leaves room for the random prefix `createMediaTempFilePath` prepends.
const MAX_STORED_FILE_NAME_BYTES = 200

// A generated path may only ever gain a short, purely alphanumeric suffix.
const SAFE_EXTENSION = /^\.[a-z0-9]{1,10}$/

// The stored path's extension is derived from the (already validated) content
// type rather than the supplied name. A name only has to contain a dot to steer
// the object key's suffix — `clip.mp4/../../evil.html` reduces to `evil.html`,
// and `photo.jpg` + 300 characters produces a key no filesystem will accept —
// and nothing downstream re-checks it. Mapping from the content type instead
// keeps the suffix describing the bytes actually stored. QuickTime is stored
// under `.mp4`, which is what the sync and presigned upload paths already
// advertise for it.
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'video/mp4': '.mp4',
  'video/quicktime': '.mp4',
  'video/webm': '.webm',
  'audio/mp4': '.m4a'
}

const stripControlCharacters = (value: string) =>
  Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0
      return code > 0x1f && code !== 0x7f
    })
    .join('')

const truncateToByteLength = (value: string, maxBytes: number) => {
  if (Buffer.byteLength(value) <= maxBytes) return value
  let truncated = ''
  let usedBytes = 0
  // Iterate by code point so a multi-byte character is never cut in half.
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character)
    if (usedBytes + characterBytes > maxBytes) break
    truncated += character
    usedBytes += characterBytes
  }
  return truncated
}

/**
 * Reduces a supplied file name to a single inert path segment: no directory
 * components, no control characters, no bare directory references, bounded
 * length. The result is safe to join to a directory and to persist.
 */
export const sanitizeStoredFileName = (fileName: string): string => {
  // Cut at the last separator of EITHER platform. `path.basename` only knows the
  // running platform's, so on POSIX it keeps `..\..\evil.mp4` whole — inert for
  // `join` here, but the same value is handed to other systems (object keys,
  // `Content-Disposition`) that do treat a backslash as a separator.
  const lastSeparator = Math.max(
    fileName.lastIndexOf('/'),
    fileName.lastIndexOf('\\')
  )
  const baseName = truncateToByteLength(
    stripControlCharacters(fileName.slice(lastSeparator + 1)).trim(),
    MAX_STORED_FILE_NAME_BYTES
  )
  // `.` and `..` are directory references rather than names: `join` resolves
  // them away, so they must never survive as a segment.
  if (!baseName || baseName === '.' || baseName === '..') {
    return FALLBACK_STORED_FILE_NAME
  }
  return baseName
}

/**
 * The extension to give a generated storage path for an upload of
 * `contentType`. Falls back to the supplied name's extension only when the
 * content type is unknown — which the upload routes already reject — and then
 * only when it is a short alphanumeric token.
 */
export const getStoredMediaExtension = (
  contentType: string,
  fileName: string
): string => {
  const normalizedContentType =
    contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  const mappedExtension = EXTENSION_BY_CONTENT_TYPE[normalizedContentType]
  if (mappedExtension) return mappedExtension

  const extension = extname(sanitizeStoredFileName(fileName)).toLowerCase()
  return SAFE_EXTENSION.test(extension) ? extension : ''
}

/**
 * Builds a collision-free path inside the OS temp directory for `fileName`,
 * which is reduced to a sanitized basename first.
 */
export const createMediaTempFilePath = (fileName: string): string => {
  const directory = tmpdir()
  const randomPrefix = crypto.randomBytes(8).toString('hex')
  // The separator between prefix and name is load-bearing: concatenated
  // directly, a name starting with `..` forms a single `..`-prefixed segment
  // (`deadbeef../../evil.mp4`) that `join` then resolves upwards.
  const filePath = join(
    directory,
    `${randomPrefix}-${sanitizeStoredFileName(fileName)}`
  )
  // Defence in depth: a sanitized name cannot contain a separator, so this never
  // trips today — it keeps the guarantee true if the sanitizer is ever loosened.
  if (resolve(dirname(filePath)) !== resolve(directory)) {
    throw new MediaValidationError('Invalid media file name')
  }
  return filePath
}
