import { htmlToDOM } from 'html-react-parser'
import type {
  DOMNode,
  Element as HtmlElement,
  Text as HtmlText
} from 'html-react-parser'
import sharp from 'sharp'

import {
  MAX_AVIF_INPUT_PIXELS,
  MAX_IMAGE_INPUT_PIXELS
} from '@/lib/services/medias/constants'
import { isBlueskyHostUrl } from '@/lib/utils/blueskyHost'
import {
  BLUESKY_MAX_GRAPHEMES,
  BLUESKY_MAX_UTF8_BYTES,
  countBlueskyGraphemes,
  countBlueskyUtf8Bytes
} from '@/lib/utils/blueskyText'

// Turning a local post into a Bluesky post: its Markdown text as plain text,
// the text cut to Bluesky's limits with a link back to the original, and an
// image re-encoded to fit Bluesky's 1 MB blob limit.

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme'
})

const splitGraphemes = (text: string): string[] =>
  Array.from(graphemeSegmenter.segment(text), (part) => part.segment)

// A URL is left untouched by the emphasis stripping below, so underscores in
// a path do not read as emphasis.
const URL_PATTERN = /(\bhttps?:\/\/[^\s<>"'`]+)/g

const CODE_BLOCK_PATTERN = /```[^\n]*\n?([\s\S]*?)```/g
const CODE_SPAN_PATTERN = /`([^`\n]+)`/g
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const LINK_PATTERN = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
// `[label][1]` and its `[1]: https://…` definition line.
const REFERENCE_DEFINITION_PATTERN =
  /^[ \t]*\[([^\]]+)\]:[ \t]*(\S+)(?:[ \t]+"[^"]*")?[ \t]*$/gm
const REFERENCE_LINK_PATTERN = /\[([^\]]*)\]\[([^\]]*)\]/g
// `<https://…>` autolinks become the bare URL.
const AUTOLINK_PATTERN = /<([a-z][a-z0-9+.-]*:[^>\s]+)>/gi
// Block markers at the start of a line: a heading, a blockquote or a list item.
const HEADING_PATTERN = /^[ \t]{0,3}#{1,6}[ \t]+/gm
const BLOCKQUOTE_PATTERN = /^[ \t]{0,3}>[ \t]?/gm
const LIST_MARKER_PATTERN = /^[ \t]{0,3}(?:[-*+]|\d+[.)])[ \t]+/gm

const stripEmphasis = (text: string): string =>
  text
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '$1')
    .replace(/\*(?=\S)([^*\n]*?\S)\*/g, '$1')
    // Only underscores around a word, so snake_case stays as written.
    .replace(/(?<![A-Za-z0-9])_(?=\S)([^_\n]*?\S)_(?![A-Za-z0-9])/g, '$1')

const stripEmphasisOutsideUrls = (text: string): string =>
  text
    .split(URL_PATTERN)
    .map((part, index) => (index % 2 === 1 ? part : stripEmphasis(part)))
    .join('')

const linkToText = (label: string, url: string): string => {
  const trimmed = label.trim()
  if (!trimmed || trimmed === url) return url
  return `${trimmed} ${url}`
}

/**
 * The stored post text is Markdown (Marked with gfm and breaks). Bluesky takes
 * plain text, so links become `label url`, emphasis, code, heading, blockquote
 * and list markers go while their text stays, and bare URLs, #tags and
 * @mentions are left as written.
 */
export const markdownToBlueskyPlainText = (text: string): string => {
  // Code keeps its text but not its markers, and is not read as Markdown.
  const code: string[] = []
  // Private-use characters, so the placeholder cannot collide with the text.
  const placeholder = (index: number) => `\uE000${index}\uE001`
  const withoutCode = text
    .replace(CODE_BLOCK_PATTERN, (_match, inner: string) => {
      code.push(inner.replace(/\n$/, ''))
      return placeholder(code.length - 1)
    })
    .replace(CODE_SPAN_PATTERN, (_match, inner: string) => {
      code.push(inner)
      return placeholder(code.length - 1)
    })

  // Reference definitions are collected first, then their links resolved.
  const references = new Map<string, string>()
  const withoutDefinitions = withoutCode.replace(
    REFERENCE_DEFINITION_PATTERN,
    (_match, id: string, url: string) => {
      references.set(id.trim().toLowerCase(), url)
      return ''
    }
  )

  const plain = stripEmphasisOutsideUrls(
    withoutDefinitions
      .replace(IMAGE_PATTERN, (_match, label: string, url: string) =>
        linkToText(label, url)
      )
      .replace(LINK_PATTERN, (_match, label: string, url: string) =>
        linkToText(label, url)
      )
      .replace(REFERENCE_LINK_PATTERN, (_match, label: string, id: string) => {
        const key = (id || label).trim().toLowerCase()
        const url = references.get(key)
        return url ? linkToText(label, url) : label
      })
      .replace(AUTOLINK_PATTERN, (_match, url: string) => url)
      .replace(HEADING_PATTERN, '')
      .replace(BLOCKQUOTE_PATTERN, '')
      .replace(LIST_MARKER_PATTERN, '')
  )

  return plain
    .replace(/\uE000(\d+)\uE001/g, (_match, index: string) => {
      return code[Number(index)] ?? ''
    })
    .trim()
}

const SENTENCE_END = new Set(['.', '!', '?', '…', '\n', '。', '！', '？'])
const CJK_SENTENCE_END = new Set(['…', '\n', '。', '！', '？'])

const isSentenceEnd = (graphemes: string[], index: number): boolean => {
  const grapheme = graphemes[index]
  if (!SENTENCE_END.has(grapheme)) return false
  if (CJK_SENTENCE_END.has(grapheme)) return true
  // A full stop inside a number or a domain is not the end of a sentence.
  const next = graphemes[index + 1]
  return next === undefined || /\s/.test(next)
}

const fits = (text: string, maxGraphemes: number): boolean =>
  countBlueskyGraphemes(text) <= maxGraphemes &&
  countBlueskyUtf8Bytes(text) <= BLUESKY_MAX_UTF8_BYTES

// The longest prefix of `graphemes` that fits in `maxGraphemes` graphemes and
// `maxBytes` UTF-8 bytes.
const longestFittingPrefix = (
  graphemes: string[],
  maxGraphemes: number,
  maxBytes: number
): number => {
  let bytes = 0
  let count = 0
  for (const grapheme of graphemes) {
    if (count >= maxGraphemes) break
    const nextBytes = bytes + countBlueskyUtf8Bytes(grapheme)
    if (nextBytes > maxBytes) break
    bytes = nextBytes
    count += 1
  }
  return count
}

// The grapheme ranges of the URLs in `text`, so a cut can be kept out of one.
const urlGraphemeRanges = (
  text: string
): Array<{ start: number; end: number }> => {
  const ranges: Array<{ start: number; end: number }> = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const startChar = match.index ?? 0
    const endChar = startChar + match[0].length
    ranges.push({
      start: countBlueskyGraphemes(text.slice(0, startChar)),
      end: countBlueskyGraphemes(text.slice(0, endChar))
    })
  }
  return ranges
}

// A cut inside a URL would leave a broken link: cut before the URL instead.
const avoidCuttingUrl = (
  limit: number,
  ranges: Array<{ start: number; end: number }>
): number => {
  for (const { start, end } of ranges) {
    if (limit > start && limit < end) return start
  }
  return limit
}

export const cutToRoom = (
  text: string,
  room: number,
  byteRoom: number
): string => {
  const graphemes = splitGraphemes(text)
  const fitting = longestFittingPrefix(graphemes, room, byteRoom)
  if (fitting >= graphemes.length) return text
  const limit = avoidCuttingUrl(fitting, urlGraphemeRanges(text))
  if (limit <= 0) return ''

  let sentenceCut = -1
  for (let index = 0; index < limit; index += 1) {
    if (isSentenceEnd(graphemes, index)) sentenceCut = index + 1
  }
  // A sentence end that keeps less than ~40% of the room cuts too much.
  if (sentenceCut >= Math.ceil(limit * 0.4)) {
    return graphemes.slice(0, sentenceCut).join('').trimEnd()
  }

  for (let index = limit - 1; index > 0; index -= 1) {
    if (/\s/.test(graphemes[index])) {
      return graphemes.slice(0, index).join('').trimEnd()
    }
  }

  return graphemes.slice(0, limit).join('').trimEnd()
}

type HtmlDomNode = DOMNode | HtmlElement['children'][number]

const POLL_BLOCK_TAGS = new Set([
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'pre'
])

// Bound recursion so deeply nested HTML cannot overflow the call stack. Each
// nested list level costs two element levels, so the limit sits well above the
// nesting a post can hold; the iterative fallback below takes over past it.
const MAX_POLL_HTML_DEPTH = 64

const MENTION_HREF_PATH_PATTERN = /^\/(@[^/\s@]+@[^/\s@]+)$/

// Next text starting with whitespace or closing/clause punctuation drops a
// pending trailing space from a preceding anchor label.
const DROP_PENDING_SPACE_PATTERN = /^[\s.,;:!?)\]]/

const isHtmlText = (node: HtmlDomNode): node is HtmlText => node.type === 'text'

const isHtmlElement = (node: HtmlDomNode): node is HtmlElement =>
  node.type === 'tag'

const isAbsoluteHttpUrl = (value: string): boolean => {
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const hasClass = (node: HtmlElement, className: string): boolean => {
  const value = node.attribs?.class
  if (!value) return false
  return value.split(/\s+/).includes(className)
}

const mentionFromHref = (href: string | undefined): string | null => {
  if (!href) return null
  try {
    const parsed = new URL(href.trim(), 'https://placeholder.invalid')
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    const match = MENTION_HREF_PATH_PATTERN.exec(parsed.pathname)
    return match ? match[1] : null
  } catch {
    return null
  }
}

// A Bluesky profile or hashtag link, the shape the AppView renders a mention
// or a tag as. Its visible text is the mention or tag itself, so the URL is
// not appended; any other link keeps its URL even when its label starts with
// `@` or `#`.
const isBlueskyProfileOrHashtagUrl = (href: string): boolean => {
  if (!isBlueskyHostUrl(href)) return false
  try {
    const { pathname } = new URL(href)
    return /^\/(?:profile|hashtag)\/[^/]+\/?$/.test(pathname)
  } catch {
    return false
  }
}

const isDisplayTextForHref = (label: string, href: string): boolean => {
  if (label === href) return true
  const candidates = new Set<string>([href])
  const withoutScheme = href.replace(/^https?:\/\//i, '')
  candidates.add(withoutScheme)
  candidates.add(withoutScheme.replace(/^www\./i, ''))
  try {
    const parsed = new URL(href)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const host = parsed.host
      const bareHost = host.startsWith('www.') ? host.slice(4) : host
      const pathAndSearch = `${parsed.pathname}${parsed.search}`
      const suffix = pathAndSearch === '/' ? '' : pathAndSearch
      candidates.add(`${host}${suffix}`)
      candidates.add(`${bareHost}${suffix}`)
      if (parsed.hash) {
        candidates.add(`${host}${suffix}${parsed.hash}`)
        candidates.add(`${bareHost}${suffix}${parsed.hash}`)
      }
    }
  } catch {
    // Non-URL or relative href: keep the string candidates collected above.
  }

  if (candidates.has(label)) return true
  const truncated = label.endsWith('…')
    ? label.slice(0, -1)
    : label.endsWith('...')
      ? label.slice(0, -3)
      : null
  if (truncated) {
    for (const candidate of candidates) {
      if (candidate.startsWith(truncated)) return true
    }
  }
  return false
}

const blockNewlines = (tag: string, insideList: boolean): number => {
  if (tag === 'li') return 1
  if (tag === 'ul' || tag === 'ol') return insideList ? 1 : 2
  return POLL_BLOCK_TAGS.has(tag) ? 2 : 0
}

type FallbackStackEntry =
  | { node: HtmlDomNode; pre: boolean; insideList: boolean }
  | { newlines: number }

type WalkPollHtmlOptions = {
  depth?: number
  preserveLeadingSpace?: boolean
}

const walkPollHtmlNodes = (
  nodes: HtmlDomNode[],
  options: WalkPollHtmlOptions = {}
): string => {
  const { depth = 0, preserveLeadingSpace = false } = options
  let out = ''
  let pendingSpace = false

  const trimTrailingHorizontalSpace = () => {
    out = out.replace(/[ \t]+$/, '')
  }

  const appendText = (raw: string, pre = false) => {
    const text = pre ? raw : raw.replace(/\s+/g, ' ')
    if (!text) return
    const emitPending = pendingSpace && !DROP_PENDING_SPACE_PATTERN.test(text)
    pendingSpace = false
    if (emitPending && out && !/\s$/.test(out)) out += ' '
    if (pre) {
      out += text
      return
    }
    const atBoundary =
      out.endsWith('\n') || out.endsWith(' ') || (!out && !preserveLeadingSpace)
    out += atBoundary && text.startsWith(' ') ? text.slice(1) : text
  }

  const appendUrl = (url: string, afterLabel = false) => {
    const needsSpace =
      afterLabel || pendingSpace || (out.length > 0 && !/[\s([]$/.test(out))
    pendingSpace = false
    if (needsSpace && out.length > 0 && !/\s$/.test(out)) out += ' '
    out += url
  }

  const appendLineBreak = (pre: boolean) => {
    pendingSpace = false
    if (!pre) trimTrailingHorizontalSpace()
    out += '\n'
  }

  const ensureNewlines = (count: number, trimTrailing = true) => {
    pendingSpace = false
    if (!out) return
    if (trimTrailing) trimTrailingHorizontalSpace()
    if (!out) return
    let trailing = 0
    while (trailing < out.length && out[out.length - 1 - trailing] === '\n') {
      trailing += 1
    }
    if (trailing < count) out += '\n'.repeat(count - trailing)
  }

  const emitAnchor = (
    node: HtmlElement,
    pre: boolean,
    currentDepth: number
  ) => {
    const rawVisible = walkPollHtmlNodes(node.children, {
      depth: currentDepth + 1,
      preserveLeadingSpace: true
    })
    const hasLeadingSpace = /^\s/.test(rawVisible)
    const hasTrailingSpace = /\s$/.test(rawVisible)
    const visible = rawVisible.trim()

    const href = node.attribs?.href?.trim() ?? ''
    let text = visible
    let url = ''
    if (hasClass(node, 'mention')) {
      text = mentionFromHref(href) ?? visible
    } else if (
      !hasClass(node, 'hashtag') &&
      !(
        (visible.startsWith('@') || visible.startsWith('#')) &&
        isBlueskyProfileOrHashtagUrl(href)
      )
    ) {
      if (href && isAbsoluteHttpUrl(href)) {
        url = href
        if (isDisplayTextForHref(visible, href)) text = ''
      }
    }

    if (!text && !url) {
      if (hasLeadingSpace || hasTrailingSpace) appendText(' ', pre)
      return
    }
    if (hasLeadingSpace) appendText(' ', pre)
    if (text) appendText(text, pre)
    if (url) appendUrl(url, Boolean(text))
    if (hasTrailingSpace && out && !/\s$/.test(out)) pendingSpace = true
  }

  const visitIteratively = (
    list: HtmlDomNode[],
    initialPre: boolean,
    initialInsideList: boolean
  ) => {
    const stack: FallbackStackEntry[] = []
    for (let index = list.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: list[index],
        pre: initialPre,
        insideList: initialInsideList
      })
    }

    while (stack.length > 0) {
      const entry = stack.pop()
      if (!entry) continue
      if ('newlines' in entry) {
        ensureNewlines(entry.newlines)
        continue
      }

      const { node, pre, insideList } = entry
      if (isHtmlText(node)) {
        appendText(node.data, pre)
        continue
      }
      if (!isHtmlElement(node)) continue

      const tag = node.name.toLowerCase()
      if (tag === 'br') {
        appendLineBreak(pre)
        continue
      }

      const newlines = blockNewlines(tag, insideList)
      if (newlines > 0) {
        ensureNewlines(newlines)
        stack.push({ newlines })
      }
      const childPre = pre || tag === 'pre'
      const childInsideList =
        insideList || tag === 'ul' || tag === 'ol' || tag === 'li'
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push({
          node: node.children[index],
          pre: childPre,
          insideList: childInsideList
        })
      }
    }
  }

  const visit = (
    list: HtmlDomNode[],
    pre: boolean,
    insideList: boolean,
    currentDepth: number
  ) => {
    if (currentDepth >= MAX_POLL_HTML_DEPTH) {
      visitIteratively(list, pre, insideList)
      return
    }

    for (const node of list) {
      if (isHtmlText(node)) {
        appendText(node.data, pre)
        continue
      }
      if (!isHtmlElement(node)) continue

      const tag = node.name.toLowerCase()
      if (tag === 'br') {
        appendLineBreak(pre)
        continue
      }
      if (tag === 'img') {
        const alt = (node.attribs?.alt ?? '').trim()
        const src = (node.attribs?.src ?? '').trim()
        const hasHttpSrc = isAbsoluteHttpUrl(src)
        const label = hasHttpSrc && alt === src ? '' : alt
        if (label) appendText(label, pre)
        if (hasHttpSrc) appendUrl(src, Boolean(label))
        continue
      }
      if (tag === 'a') {
        emitAnchor(node, pre, currentDepth)
        continue
      }
      if (tag === 'pre') {
        ensureNewlines(2)
        const start = out.length
        visit(node.children, true, false, currentDepth + 1)
        if (out.length > start && out.endsWith('\n')) out = out.slice(0, -1)
        if (out.length > start) ensureNewlines(2, false)
        continue
      }

      const newlines = blockNewlines(tag, insideList)
      if (newlines > 0) ensureNewlines(newlines)
      const childInsideList =
        insideList || tag === 'ul' || tag === 'ol' || tag === 'li'
      visit(node.children, pre, childInsideList, currentDepth + 1)
      if (newlines > 0) ensureNewlines(newlines)
    }
  }

  visit(nodes, false, false, depth)
  return out
}

// A poll stores rendered HTML (convertMarkdownText): walk the parsed DOM to
// recover full link/image URLs, full remote mention handles, block and list
// breaks, and decoded entities consistent with markdownToBlueskyPlainText.
export const pollHtmlToBlueskyPlainText = (html: string): string => {
  if (!html) return ''
  return walkPollHtmlNodes(htmlToDOM(html))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export type BuildCrosspostTextParams = {
  text: string
  fullUrl: string
  maxGraphemes?: number
  forceLink?: boolean
}

export type BuildCrosspostTextResult = {
  text: string
  truncated: boolean
}

/**
 * Fits a post's plain text into a Bluesky post, adding a link back to the
 * original when the text does not fit or `forceLink` asks for it. The text is
 * cut at a sentence end when one is close enough, else at a word, else at a
 * grapheme boundary; a grapheme is never split.
 */
export const buildCrosspostText = ({
  text,
  fullUrl,
  maxGraphemes = BLUESKY_MAX_GRAPHEMES,
  forceLink = false
}: BuildCrosspostTextParams): BuildCrosspostTextResult => {
  if (!forceLink && fits(text, maxGraphemes)) {
    return { text, truncated: false }
  }
  if (forceLink && fits(`${text}\n\n${fullUrl}`, maxGraphemes)) {
    return { text: `${text}\n\n${fullUrl}`, truncated: false }
  }

  const suffix = `… ${fullUrl}`
  const room = maxGraphemes - countBlueskyGraphemes(suffix)
  const byteRoom = BLUESKY_MAX_UTF8_BYTES - countBlueskyUtf8Bytes(suffix)
  const cut = cutToRoom(text, Math.max(0, room), Math.max(0, byteRoom))
  if (!cut) return { text: fullUrl, truncated: true }
  return { text: `${cut}${suffix}`, truncated: true }
}

export const BLUESKY_MAX_IMAGE_BYTES = 1_000_000

export type BlueskyImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp'

export type FittedBlueskyImage = {
  bytes: Buffer
  mimeType: BlueskyImageMimeType
  width: number
  height: number
}

/** The image cannot be made to fit Bluesky's 1 MB limit. */
export class BlueskyImageTooLargeError extends Error {
  constructor(message = 'The image is too large for Bluesky') {
    super(message)
    this.name = 'BlueskyImageTooLargeError'
  }
}

/** The bytes are not an image Bluesky accepts, or cannot be decoded safely. */
export class BlueskyImageFormatError extends Error {
  constructor(message = 'The image is not a format Bluesky accepts') {
    super(message)
    this.name = 'BlueskyImageFormatError'
  }
}

const KEPT_IMAGE_TYPES = new Set<BlueskyImageMimeType>([
  'image/jpeg',
  'image/png',
  'image/webp'
])

// The formats this function will decode. Anything else (SVG, PDF, a video
// frame, an unknown container) is refused rather than handed to sharp.
const ACCEPTED_INPUT_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif'])

const JPEG_QUALITIES = [90, 80, 70, 60, 50]
const MAX_LONGEST_SIDES = [2000, 1500, 1000]

type SniffedImage = {
  format: string
  mimeType: BlueskyImageMimeType | null
  width: number
  height: number
  pages: number
  // AVIF is decoded by libheif/libaom, which cannot shrink-on-load, so it gets
  // the lower pixel cap.
  isAvif: boolean
}

type SharpMetadata = Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>

// Reads the header only, so the pixel cap here bounds a declared size rather
// than a decode. The format decides the cap the decode below uses.
const sniffImage = async (buffer: Buffer): Promise<SniffedImage> => {
  let metadata: SharpMetadata
  try {
    metadata = await sharp(buffer, {
      limitInputPixels: MAX_IMAGE_INPUT_PIXELS
    }).metadata()
  } catch (error) {
    throw new BlueskyImageFormatError(
      error instanceof Error ? error.message : undefined
    )
  }

  const format = metadata.format ?? ''
  if (!ACCEPTED_INPUT_FORMATS.has(format)) {
    throw new BlueskyImageFormatError()
  }
  const isAvif = format === 'heif' && metadata.compression === 'av1'
  if (format === 'heif' && !isAvif) {
    // HEIC/HEVC is a container this instance does not accept as an image.
    throw new BlueskyImageFormatError()
  }

  const mimeType: BlueskyImageMimeType | null =
    format === 'heif'
      ? null
      : KEPT_IMAGE_TYPES.has(`image/${format}` as BlueskyImageMimeType)
        ? (`image/${format}` as BlueskyImageMimeType)
        : null

  return {
    format,
    mimeType,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    pages: metadata.pages ?? 1,
    isAvif
  }
}

const inputPixelLimit = (image: SniffedImage) =>
  image.isAvif ? MAX_AVIF_INPUT_PIXELS : MAX_IMAGE_INPUT_PIXELS

// The pipeline every quality step clones: EXIF orientation applied and the
// image already resized to the step's longest side, so the full-size frame is
// decoded once rather than once per quality.
const resizedPipeline = (
  buffer: Buffer,
  image: SniffedImage,
  longestSide: number
) =>
  sharp(buffer, {
    animated: false,
    limitInputPixels: inputPixelLimit(image)
  })
    .rotate()
    .resize({
      width: longestSide,
      height: longestSide,
      fit: 'inside',
      withoutEnlargement: true
    })

type SharpPipeline = ReturnType<typeof sharp>

const encodeJpeg = async (
  pipeline: SharpPipeline,
  quality: number
): Promise<{ data: Buffer; width: number; height: number }> => {
  const { data, info } = await pipeline
    .clone()
    // JPEG has no alpha: put a transparent image on white.
    .flatten({ background: '#ffffff' })
    .jpeg({ quality })
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

/**
 * Returns the image as it is when it is already a JPEG, PNG or WebP under
 * Bluesky's 1 MB limit, else re-encodes it to JPEG (alpha flattened onto
 * white), stepping the quality down and then the size, until it fits. Only the
 * first frame of an animated image is kept. The format is sniffed from the
 * bytes, never taken from a caller's Content-Type, and only the formats Bluesky
 * accepts are decoded; anything else throws `BlueskyImageFormatError`.
 */
export const fitImageForBluesky = async (
  buffer: Buffer
): Promise<FittedBlueskyImage> => {
  const image = await sniffImage(buffer)
  const isAnimated = image.pages > 1
  if (
    image.mimeType &&
    !isAnimated &&
    buffer.byteLength <= BLUESKY_MAX_IMAGE_BYTES &&
    image.width &&
    image.height
  ) {
    return {
      bytes: buffer,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height
    }
  }

  for (const longestSide of MAX_LONGEST_SIDES) {
    const pipeline = resizedPipeline(buffer, image, longestSide)
    for (const quality of JPEG_QUALITIES) {
      const { data, width, height } = await encodeJpeg(pipeline, quality)
      if (data.byteLength <= BLUESKY_MAX_IMAGE_BYTES) {
        return { bytes: data, mimeType: 'image/jpeg', width, height }
      }
    }
  }

  throw new BlueskyImageTooLargeError()
}
