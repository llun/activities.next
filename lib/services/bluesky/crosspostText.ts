import sharp from 'sharp'

import {
  MAX_AVIF_INPUT_PIXELS,
  MAX_IMAGE_INPUT_PIXELS
} from '@/lib/services/medias/constants'
import {
  BLUESKY_MAX_GRAPHEMES,
  BLUESKY_MAX_UTF8_BYTES,
  countBlueskyGraphemes,
  countBlueskyUtf8Bytes
} from '@/lib/utils/blueskyText'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

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

const cutToRoom = (text: string, room: number, byteRoom: number): string => {
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

// A poll stores rendered HTML (convertMarkdownText): keep its paragraphs and
// line breaks, and let htmlToPlainText drop the tags and decode entities.
export const pollHtmlToBlueskyPlainText = (html: string): string =>
  html
    .split(/<\/p\s*>/i)
    .map((paragraph) =>
      paragraph
        .split(/<br\s*\/?>/i)
        .map(htmlToPlainText)
        .join('\n')
        .trim()
    )
    .filter(Boolean)
    .join('\n\n')

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
