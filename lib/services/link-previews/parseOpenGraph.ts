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

// Only the document head is parsed. The byte cap on the fetch bounds transfer,
// not CPU: `htmlToDOM` is quadratic in nesting depth, and a page of deeply
// nested divs that still fits under 1 MiB was measured blocking the event loop
// for ~9s (and overflowing the stack past ~15k deep, silently yielding no
// card). That is synchronous, non-cancellable work which on the default
// in-process queue runs inside the request that created the status. Every tag
// this reads is defined to live in <head>, so slicing there removes the entire
// class of hostile <body> payloads rather than trying to time-bound them.
export const MAX_HEAD_LENGTH = 128 * 1024

const HEAD_END = '</head>'

// ASCII-only lowercasing, for the same reason `getDeclaredCharset` needs it:
// `toLowerCase()` maps U+0130 to TWO code units, so an index taken from the
// lowercased copy no longer lines up with the original. Enough of them in the
// head and the slice reaches past `</head>`, pulling <body> markup into the
// parse — which is exactly what slicing at the head is supposed to prevent.
const asciiLower = (value: string): string =>
  value.replace(/[A-Z]/g, (character) => character.toLowerCase())

const getHeadMarkup = (html: string): string => {
  // Lowercase only as far as the search can reach: a `</head>` at or past
  // MAX_HEAD_LENGTH truncates to the same slice either way, so this is
  // identical output for a fraction of the work — the whole-document version
  // cost ~30ms on a hostile 1 MiB page, against a file whose own rationale is
  // that the byte cap must not become a CPU cost.
  const searchable = html.slice(0, MAX_HEAD_LENGTH + HEAD_END.length)
  const headEnd = asciiLower(searchable).indexOf(HEAD_END)
  const head = headEnd === -1 ? html : html.slice(0, headEnd)
  // A page with no </head> at all (or a pathologically long one) still gets a
  // bounded slice rather than the whole document.
  return head.length > MAX_HEAD_LENGTH ? head.slice(0, MAX_HEAD_LENGTH) : head
}

// The HTML spec requires a page's encoding declaration to appear within the
// first 1024 bytes, so the search never needs to look further — and must not:
// scanning the whole head with a `<meta[^>]+charset` regex backtracks
// quadratically, and a 128 KB body of bare `<meta` with no `>` was measured
// blocking the event loop for 3.3 SECONDS. That would have replaced the
// deep-nesting DoS this file was hardened against with a cheaper one.
const CHARSET_DECLARATION_WINDOW = 1024

// Attribute-level parsing, because `charset` must be read as an ATTRIBUTE of a
// meta tag and never as a substring inside one's VALUE: a loose match made
// `<meta property="og:description" content="how to set charset=windows-1252">`
// look like a windows-1252 page, which cost that article its card. The tag
// string is short and bounded, so this regex cannot run away on it.
const META_ATTRIBUTE = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g

// The index of the `>` that closes a tag, ignoring any inside a quoted value.
// Taking the first `>` anywhere truncated the tag mid-attribute, which put
// `charset=` from an ordinary sentence back in scope — so an article that merely
// described an encoding lost its card.
const findTagEnd = (source: string, tagStart: number): number => {
  let quote: string | null = null
  for (let index = tagStart; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '>') return index
  }
  return -1
}

// An unquoted attribute value runs to the next delimiter, so a self-closing
// `<meta charset=utf-8/>` yields `utf-8/` — a label matching no known encoding,
// which cost the page its card even though it declares UTF-8.
const normalizeCharsetLabel = (value: string | undefined): string | null => {
  const label = value?.trim().replace(/\/+$/, '').toLowerCase()
  return label ? label : null
}

const getTagAttributes = (tag: string): Map<string, string> => {
  const attributes = new Map<string, string>()
  META_ATTRIBUTE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = META_ATTRIBUTE.exec(tag)) !== null) {
    const name = match[1].toLowerCase()
    if (!attributes.has(name)) {
      attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '')
    }
  }
  return attributes
}

/**
 * The encoding a page declares in markup rather than in its Content-Type
 * header. `safeRemoteFetch` always decodes as UTF-8, so anything else would be
 * stored as mojibake — and the HTML5 `<meta charset>` form is the common case
 * the header check alone misses.
 */
export const getDeclaredCharset = (html: string): string | null => {
  // Comments are stripped first, because the HTML prescan skips them: a page
  // that leaves an old declaration commented out above its real one must be
  // read as declaring the real one.
  const searchWindow = html
    .slice(0, CHARSET_DECLARATION_WINDOW)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  // Lowercased once, not per iteration — the loop can run a few hundred times
  // over the window. ASCII-only on purpose: `toLowerCase()` maps U+0130 to TWO
  // code units, which shifts every later index and would slide the slice past a
  // real `charset` attribute. Tag and attribute names are ASCII anyway.
  const lowered = asciiLower(searchWindow)

  // Walked tag by tag with indexOf rather than one big regex: each tag string
  // is short, so the regexes above can never run away on it.
  let cursor = 0
  while (cursor < searchWindow.length) {
    const tagStart = lowered.indexOf('<meta', cursor)
    if (tagStart === -1) return null
    const tagEnd = findTagEnd(searchWindow, tagStart)
    const tag = searchWindow.slice(
      tagStart,
      tagEnd === -1 ? searchWindow.length : tagEnd
    )

    const attributes = getTagAttributes(tag)

    // `<meta charset=…>` directly...
    const charset = normalizeCharsetLabel(attributes.get('charset'))
    if (charset) return charset

    // ...or the legacy `<meta http-equiv="Content-Type" content="…; charset=…">`,
    // where the encoding genuinely does live inside an attribute value.
    if (attributes.get('http-equiv')?.toLowerCase().trim() === 'content-type') {
      const legacy = attributes.get('content')?.match(/charset\s*=\s*([\w-]+)/i)
      const normalized = normalizeCharsetLabel(legacy?.[1])
      if (normalized) return normalized
    }

    if (tagEnd === -1) return null
    cursor = tagEnd + 1
  }
  return null
}

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

// `imageWidth`/`imageHeight` are `integer` columns. SQLite stores a 64-bit
// value happily; PostgreSQL rejects anything larger and fails the INSERT — and
// because that throw is caught and recorded as a failed fetch, and nothing ever
// re-runs the job, a page serving an absurd `og:image:width` would cost itself
// its card permanently on PG while working fine on SQLite (which is what the
// whole test suite runs on). Same treatment as the varchar and timestamp caps
// above: bound the value rather than let the backend reject the row.
const MAX_INT4 = 2147483647

const parseDimension = (value: string | undefined): number | null => {
  if (!value?.trim()) return null
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  if (parsed > MAX_INT4) return null
  return parsed
}

// Years either side of this are not real publication dates, and a value outside
// the backend's timestamp domain fails the INSERT — which would cost the whole
// card, not just its date.
const MIN_PUBLISHED_AT = Date.UTC(1900, 0, 1)
const MAX_PUBLISHED_AT = Date.UTC(2200, 0, 1)

const parsePublishedAt = (value: string | undefined): number | null => {
  if (!value?.trim()) return null
  const parsed = Date.parse(value.trim())
  if (Number.isNaN(parsed)) return null
  if (parsed < MIN_PUBLISHED_AT || parsed > MAX_PUBLISHED_AT) return null
  return parsed
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
    collectMeta(htmlToDOM(getHeadMarkup(html)) as DomNode[], meta)
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
  // Cleaned like every other stored string: this is served as the API's
  // `author_url`, so a bidi override or a newline in it is the same display
  // hazard it would be anywhere else.
  const cleanedAuthor = cleanText(articleAuthor, MAX_PREVIEW_URL_LENGTH)
  const authorUrl =
    cleanedAuthor && isHttpUrl(cleanedAuthor) ? cleanedAuthor : null

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
