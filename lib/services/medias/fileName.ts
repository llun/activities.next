import crypto from 'crypto'
import { tmpdir } from 'os'
import { dirname, extname, join, resolve } from 'path'

import { MediaValidationError } from '@/lib/services/medias/errors'

// Upload file names are attacker-controlled. Only a browser multipart upload is
// guaranteed to send a bare basename; every non-browser client of
// `POST /api/v1/media`, `POST /api/v2/media` and the presigned flow puts an
// arbitrary string in the field. `path.join` resolves `..` segments, so joining
// such a name to a directory walks out of it — `join(tmpdir(), 'deadbeefdeadbeef'
// + '../../../evil.mp4')` lands a directory above `tmpdir()`. Everything the
// storage drivers derive from a supplied name goes through this module, so the
// reduction happens once, at the point the name enters storage.

/** Name used when a supplied file name reduces to nothing usable. */
export const FALLBACK_STORED_FILE_NAME = 'file'

// `medias.originalFileName` is `varchar(255)` and most filesystems cap a single
// path segment at 255 bytes, so the stored name is bounded by the tighter of the
// two. 200 leaves room for the random prefix `createMediaTempFilePath` prepends.
const MAX_STORED_FILE_NAME_BYTES = 200

// The stored path's extension is derived from the (already validated) content
// type rather than the supplied name. A name only has to contain a dot to steer
// the suffix — `extname('clip.mp4/../../evil.html')` is `.html`, which on the
// local driver became the stored filename and made `getFile` serve an
// mp4/HTML polyglot as `text/html` on the instance origin. Mapping from the
// content type instead keeps the suffix describing the bytes actually stored.
// QuickTime is stored under `.mp4`, which is what the sync and presigned upload
// paths already advertise for it.
//
// Every entry of `ACCEPTED_FILE_TYPES` must appear here — a type without a
// mapping falls through to the name, which is the hole this module closes.
// `fileName.test.ts` asserts that, so the map cannot silently fall behind.
export const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'video/mp4': '.mp4',
  'video/quicktime': '.mp4',
  'video/webm': '.webm',
  'audio/mp4': '.m4a'
}

// The only extensions the fallback below may echo back from a supplied name.
// A shape check (`/^\.[a-z0-9]{1,10}$/`) would still admit `.html`, `.svg` and
// `.js` — precisely what the content-type mapping exists to prevent — so the
// fallback is an allowlist of media extensions instead, including the common
// spellings the map does not emit.
const FALLBACK_EXTENSIONS = new Set([
  ...Object.values(EXTENSION_BY_CONTENT_TYPE),
  '.jpeg',
  '.mov',
  '.m4v'
])

// Characters a stored name may never contain:
// - C0 controls and DEL: `fs` rejects NUL outright, and CR/LF are header
//   injection anywhere the name is echoed.
// - The C1 range, for the same reason one layer up.
// - Zero-width, bidi embedding/override/isolate, and line/paragraph separators:
//   the stored name is federated and rendered to other users as the
//   attachment's name, where these let it display as something other than what
//   is stored — a U+202E before `gnp.exe` renders the tail reversed, so an
//   executable name reads as `photo.png`.
const isStrippedCharacter = (code: number) =>
  code <= 0x1f ||
  (code >= 0x7f && code <= 0x9f) ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x2029) ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069) ||
  code === 0xfeff

const stripFormattingCharacters = (value: string) =>
  Array.from(value)
    .filter((character) => !isStrippedCharacter(character.codePointAt(0) ?? 0))
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
 * components, no control or invisible characters, no bare directory references,
 * bounded length. The result is safe to join to a directory and to persist.
 */
export const sanitizeStoredFileName = (fileName: string): string => {
  // Cut at the last separator of EITHER platform. `path.basename` only knows the
  // running platform's, so on POSIX it keeps `..\..\evil.mp4` whole. That is
  // inert for `join` here, but the value is persisted and returned to clients,
  // and a name carrying a backslash would become a separator anywhere it is
  // later used to build a path or a key.
  const lastSeparator = Math.max(
    fileName.lastIndexOf('/'),
    fileName.lastIndexOf('\\')
  )
  // Trim again after truncating: cutting at the byte cap can leave the name
  // ending in the whitespace the first trim only removed from the very end.
  const baseName = truncateToByteLength(
    stripFormattingCharacters(fileName.slice(lastSeparator + 1)).trim(),
    MAX_STORED_FILE_NAME_BYTES
  ).trim()
  // `.` and `..` are directory references rather than names: `join` resolves
  // them away, so they must never survive as a segment. Checked after stripping,
  // because stripping can produce them: a NUL between two dots reduces to `..`.
  if (!baseName || baseName === '.' || baseName === '..') {
    return FALLBACK_STORED_FILE_NAME
  }
  return baseName
}

/**
 * The extension to give a generated storage path for an upload of
 * `contentType`. Falls back to the supplied name's extension only when the
 * content type is unknown — which the upload routes already reject — and then
 * only when it is a known media extension.
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
  return FALLBACK_EXTENSIONS.has(extension) ? extension : ''
}

/**
 * Throws unless `filePath` sits directly inside `directory`. Exported so the
 * guarantee has its own test: the call in `createMediaTempFilePath` is
 * unreachable while `sanitizeStoredFileName` keeps separators out of a name.
 */
export const assertDirectChildOf = (directory: string, filePath: string) => {
  if (resolve(dirname(filePath)) !== resolve(directory)) {
    throw new MediaValidationError('Invalid media file name')
  }
  return filePath
}

/**
 * Builds a collision-free path inside the OS temp directory for `fileName`,
 * which is reduced to a sanitized basename first.
 */
export const createMediaTempFilePath = (fileName: string): string => {
  const directory = tmpdir()
  const randomPrefix = crypto.randomBytes(8).toString('hex')
  // The separator between prefix and name is load-bearing. Concatenated
  // directly, a name starting with `..` merges into the prefix's own segment:
  // `<prefix>../../evil.mp4` resolves back to `<tmpdir>/evil.mp4`, a fully
  // predictable path that defeats the random prefix and lets one upload
  // overwrite another's temp file.
  return assertDirectChildOf(
    directory,
    join(directory, `${randomPrefix}-${sanitizeStoredFileName(fileName)}`)
  )
}
