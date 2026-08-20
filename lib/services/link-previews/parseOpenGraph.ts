import { htmlToDOM } from 'html-react-parser'

import { MAX_PREVIEW_URL_LENGTH } from '@/lib/services/link-previews/extractUrl'

// Column caps. `title`/`description` are text columns, but a card is a preview:
// a page that puts its whole first paragraph in og:description should not push
// that through federation and into every timeline row.
export const MAX_TITLE_LENGTH = 500
export const MAX_DESCRIPTION_LENGTH = 1000
// siteName/authorName are varchar(255), so this cap is a storage requirement on
// PostgreSQL, not a preference.
export const MAX_SHORT_TEXT_LENGTH = 255

export type LinkPreviewMetadata = {
  type: string
  title: string
  description: string | null
  siteName: string | null
  authorName: string | null
  authorUrl: string | null
  imageUrl: string | null
  imageWidth: number | null
  imageHeight: number | null
  publishedAt: number | null
}

type DomNode = {
  type?: string
  name?: string
  attribs?: Record<string, string>
  children?: DomNode[]
  data?: string
}

// Control characters, C1, bidi controls and invisible spacing. This text is
// author-controlled and is rendered back to readers, where a bidi override is a
// display-spoofing vector. U+200C/U+200D are kept because Persian, Indic
// spelling and emoji sequences need them. (`sanitizeStoredFileName` solves the
// same problem for file names, but with an allowlist — it is stricter than this
// and not the same rule.)
// Written as escapes rather than literals: every character this removes is by
// definition invisible in source, so a literal class is unreviewable (and trips
// no-irregular-whitespace).
const UNSAFE_TEXT_PATTERN = new RegExp(
  [
    '[',
    // C0 controls and DEL. Tab/newline/CR are left for the \s collapse below.
    '\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F',
    '\\u0080-\\u009F', // C1 controls
    '\\u061C', // arabic letter mark (a bidi control)
    '\\u200B', // zero-width space (U+200C/U+200D are deliberately kept)
    '\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069', // bidi marks/overrides
    '\\uFFF9-\\uFFFB', // interlinear annotation
    '\\uFEFF', // zero-width no-break space / BOM
    ']'
  ].join(''),
  'g'
)

const cleanText = (value: string | undefined, maxLength: number) => {
  if (!value) return null
  const cleaned = value
    .replace(UNSAFE_TEXT_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
}

// Mastodon's PreviewCard `type` vocabulary. Everything that is not clearly a
// video or a standalone image is a plain link — the renderer draws them all the
// same way today, so a wrong guess here costs nothing but a wrong `type` in the
// API.
const mapCardType = (ogType: string | null): string => {
  if (!ogType) return 'link'
  const normalized = ogType.toLowerCase()
  if (normalized.startsWith('video')) return 'video'
  if (normalized === 'image' || normalized === 'photo') return 'photo'
  return 'link'
}

const collectMeta = (nodes: DomNode[], meta: Map<string, string>) => {
  for (const node of nodes) {
    if (node.type === 'tag' && node.name === 'meta') {
      const attribs = node.attribs ?? {}
      const content = attribs.content
      // Most sites declare OpenGraph on `property` and twitter cards on `name`,
      // but plenty use `name` for both — read either.
      const key = attribs.property ?? attribs.name
      if (key && content !== undefined) {
        const normalizedKey = key.trim().toLowerCase()
        // First declaration wins, matching how og:image arrays are read.
        if (!meta.has(normalizedKey)) meta.set(normalizedKey, content)
      }
    }
    if (node.type === 'tag' && node.name === 'title' && !meta.has('__title')) {
      const text = (node.children ?? [])
        .filter((child) => child.type === 'text')
        .map((child) => child.data ?? '')
        .join('')
      if (text) meta.set('__title', text)
    }
    if (node.children) collectMeta(node.children, meta)
  }
}

const parseAbsoluteImageUrl = (
  value: string | undefined,
  baseUrl: string
): string | null => {
  if (!value?.trim()) return null
  try {
    const resolved = new URL(value.trim(), baseUrl)
    // https only: the page itself was fetched over https, so a relative image
    // resolves to https anyway, and an absolute http one is mixed content the
    // browser would block after we had already stored it.
    if (resolved.protocol !== 'https:') return null
    const absolute = resolved.toString()
    // Capped like every other stored field. `imageUrl` is a text column, so a
    // hostile page could otherwise put a megabyte in og:image and have it
    // embedded in every API response and every `<img src>` that renders the
    // card.
    if (absolute.length > MAX_PREVIEW_URL_LENGTH) return null
    return absolute
  } catch {
    return null
  }
}

const parseDimension = (value: string | undefined): number | null => {
  if (!value?.trim()) return null
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

const parsePublishedAt = (value: string | undefined): number | null => {
  if (!value?.trim()) return null
  const parsed = Date.parse(value.trim())
  return Number.isNaN(parsed) ? null : parsed
}

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Extract preview-card metadata from a fetched HTML page.
 *
 * Returns null when the page yields no usable title — an untitled card is worse
 * than no card, so that case is stored as a failed fetch rather than as an
 * empty row.
 */
export const parseOpenGraphMetadata = (
  html: string,
  baseUrl: string
): LinkPreviewMetadata | null => {
  if (!html.trim()) return null

  const meta = new Map<string, string>()
  try {
    collectMeta(htmlToDOM(html) as DomNode[], meta)
  } catch {
    return null
  }

  const title =
    cleanText(meta.get('og:title'), MAX_TITLE_LENGTH) ??
    cleanText(meta.get('twitter:title'), MAX_TITLE_LENGTH) ??
    cleanText(meta.get('__title'), MAX_TITLE_LENGTH)
  if (!title) return null

  const imageUrl =
    parseAbsoluteImageUrl(meta.get('og:image'), baseUrl) ??
    parseAbsoluteImageUrl(meta.get('og:image:url'), baseUrl) ??
    parseAbsoluteImageUrl(meta.get('twitter:image'), baseUrl)

  const articleAuthor = meta.get('article:author')
  const trimmedAuthor = articleAuthor?.trim()
  const authorUrl =
    trimmedAuthor &&
    isHttpUrl(trimmedAuthor) &&
    trimmedAuthor.length <= MAX_PREVIEW_URL_LENGTH
      ? trimmedAuthor
      : null

  const authorName =
    cleanText(meta.get('author'), MAX_SHORT_TEXT_LENGTH) ??
    (authorUrl ? null : cleanText(articleAuthor, MAX_SHORT_TEXT_LENGTH)) ??
    cleanText(meta.get('twitter:creator'), MAX_SHORT_TEXT_LENGTH)

  return {
    type: mapCardType(meta.get('og:type') ?? null),
    title,
    description:
      cleanText(meta.get('og:description'), MAX_DESCRIPTION_LENGTH) ??
      cleanText(meta.get('twitter:description'), MAX_DESCRIPTION_LENGTH) ??
      cleanText(meta.get('description'), MAX_DESCRIPTION_LENGTH),
    siteName:
      cleanText(meta.get('og:site_name'), MAX_SHORT_TEXT_LENGTH) ??
      cleanText(meta.get('application-name'), MAX_SHORT_TEXT_LENGTH),
    authorName,
    authorUrl,
    imageUrl,
    // Dimensions describe the image; without one they describe nothing.
    imageWidth: imageUrl ? parseDimension(meta.get('og:image:width')) : null,
    imageHeight: imageUrl ? parseDimension(meta.get('og:image:height')) : null,
    publishedAt:
      parsePublishedAt(meta.get('article:published_time')) ??
      parsePublishedAt(meta.get('og:published_time'))
  }
}
