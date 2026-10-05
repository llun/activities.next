import { getMediaFileContentSecurityPolicyHeader } from '@/lib/utils/http-headers/csp'

// The only types `GET /api/v1/files/...` serves inline. Every type the drivers
// write is here: the image encodings (`imageOutputFormat`), the accepted upload
// types, and the types the local driver derives from those extensions. None of
// them is a type a browser renders as a document that can run script — unlike
// `text/html` or `image/svg+xml`, which a stored object's metadata could
// otherwise name (an S3 object's type comes from whoever PUT it).
const INLINE_MEDIA_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'audio/mp4'
])

const normalizeContentType = (contentType: string) =>
  contentType.split(';')[0]?.trim().toLowerCase() ?? ''

/**
 * Response headers for stored upload bytes served from this origin.
 *
 * A type outside the allowlist is served as an `application/octet-stream`
 * download rather than trusted, and every response carries `nosniff` and the
 * sandboxed media CSP, so no stored object can execute as this origin whatever
 * its bytes or recorded type.
 */
export const getServedMediaHeaders = (contentType: string): Headers => {
  const normalized = normalizeContentType(contentType)
  const isInline = INLINE_MEDIA_CONTENT_TYPES.has(normalized)
  const csp = getMediaFileContentSecurityPolicyHeader()
  const headers = new Headers([
    ['Content-Type', isInline ? normalized : 'application/octet-stream'],
    ['X-Content-Type-Options', 'nosniff'],
    [csp.key, csp.value]
  ])
  if (!isInline) headers.set('Content-Disposition', 'attachment')
  return headers
}
