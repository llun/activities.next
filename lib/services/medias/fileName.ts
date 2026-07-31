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
//
// `sanitizeStoredFileName` is shared with the fitness storage drivers, which
// take the same untrusted name from every fitness upload route
// (`POST /api/v1/fitness-files`, `POST /api/v1/fitness/import`, and the Strava
// archive's multipart and presigned variants). It lives here rather than in a
// neutral module because `lib/services/fitness-files/` already reaches into
// this directory for the upload machinery it shares (`medias/quota`). The rest
// of the module — the extension map and the temp-path builder — is
// media-specific.

/** Name used when a supplied file name reduces to nothing usable. */
export const FALLBACK_STORED_FILE_NAME = 'file'

// `medias.originalFileName` and `fitness_files.fileName` are both
// `varchar(255)` — an over-long name is an insert failure on PostgreSQL, not
// just an ugly one — and most filesystems cap a single path segment at 255
// bytes, so the stored name is bounded by the tighter of the two. 200 leaves
// room for the random prefix `createMediaTempFilePath` prepends.
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

// Characters a stored name may never contain. The name is federated and shown
// to other users as the attachment's `name` (mediaIds.ts uses it as alt text
// when there is no description), so this is about display as much as about `fs`.
// - C0 controls and DEL: `fs` rejects NUL outright, and CR/LF are header
//   injection anywhere the name is echoed. Plus the C1 range, one layer up.
// - The bidi controls — marks, embeddings, overrides, isolates, and the line and
//   paragraph separators that sit in the same block. These are the Trojan Source
//   set: a U+202E before `gnp.exe` renders the tail reversed, so an executable
//   name reads as `photo.png`.
// - Invisible spacing that carries no orthographic meaning.
//
// U+200C ZWNJ and U+200D ZWJ are deliberately NOT stripped: they are
// orthographic joiners that Persian and Indic scripts need to spell words
// correctly (`می‌خواهم` becomes a misspelling without one) and that hold emoji
// sequences together (`👨‍👩‍👧‍👦` decomposes into four separate people). Neither can
// reorder text, so neither belongs in the set above.
const isStrippedCharacter = (code: number) =>
  // C0 controls, DEL, and C1
  code <= 0x1f ||
  (code >= 0x7f && code <= 0x9f) ||
  // Bidi: ALM, LRM/RLM, LS/PS + embeddings and overrides, isolates
  code === 0x061c ||
  (code >= 0x200e && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069) ||
  // Invisible spacing: ZWSP, MONGOLIAN VOWEL SEPARATOR, WORD JOINER and the
  // invisible math operators, BOM
  code === 0x200b ||
  code === 0x180e ||
  (code >= 0x2060 && code <= 0x2064) ||
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
 * A `Content-Disposition: attachment` value that safely carries `fileName`.
 *
 * `sanitizeStoredFileName` reduces a name to one inert path segment, which is
 * what storage needs, but it deliberately leaves quotes alone — they are legal
 * in a file name and harmless in a path. In a header they are not: a name
 * containing `"` closes the quoted-string early and the rest is parsed as
 * further parameters. So the quoted form here is reduced further, to characters
 * that cannot terminate or extend it, and the real name rides in the RFC 5987
 * `filename*` parameter, which every current browser prefers when both are
 * present. That keeps non-ASCII names intact — the sanitizer keeps U+200C/U+200D
 * because Persian and Indic spellings need them, and a name that is entirely
 * non-ASCII would otherwise reduce to the fallback.
 */
export const buildAttachmentContentDisposition = (fileName: string): string => {
  const storedName = sanitizeStoredFileName(fileName)
  // Anything outside this set is dropped rather than escaped: backslash escaping
  // inside a quoted-string is legal but inconsistently implemented, and this
  // parameter is only the fallback for a client that cannot read `filename*`.
  const quotedName =
    storedName.replace(/[^\w.\- ]+/g, '_').trim() || FALLBACK_STORED_FILE_NAME
  // encodeURIComponent leaves !'()* unescaped; they are not valid in RFC 5987's
  // attr-char set, so percent-encode them too.
  const encodedName = encodeURIComponent(storedName).replace(
    /['()!*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  )

  return `attachment; filename="${quotedName}"; filename*=UTF-8''${encodedName}`
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
