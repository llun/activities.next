import sharp from 'sharp'

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
 * plain text, so links become `label url`, emphasis and code markers go while
 * their text stays, and bare URLs, #tags and @mentions are left as written.
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

  const plain = stripEmphasisOutsideUrls(
    withoutCode
      .replace(IMAGE_PATTERN, (_match, label: string, url: string) =>
        linkToText(label, url)
      )
      .replace(LINK_PATTERN, (_match, label: string, url: string) =>
        linkToText(label, url)
      )
  )

  return plain.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => {
    return code[Number(index)] ?? ''
  })
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

const cutToRoom = (text: string, room: number, byteRoom: number): string => {
  const graphemes = splitGraphemes(text)
  const limit = longestFittingPrefix(graphemes, room, byteRoom)
  if (limit >= graphemes.length) return text

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

const KEPT_IMAGE_TYPES = new Set<BlueskyImageMimeType>([
  'image/jpeg',
  'image/png',
  'image/webp'
])

const JPEG_QUALITIES = [90, 80, 70, 60, 50]
const MAX_LONGEST_SIDES = [2000, 1500, 1000]

const encodeJpeg = async (
  buffer: Buffer,
  longestSide: number | null,
  quality: number
): Promise<{ data: Buffer; width: number; height: number }> => {
  let pipeline = sharp(buffer, { animated: false })
  if (longestSide !== null) {
    pipeline = pipeline.resize({
      width: longestSide,
      height: longestSide,
      fit: 'inside',
      withoutEnlargement: true
    })
  }
  const { data, info } = await pipeline
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
 * first frame of an animated image is kept.
 */
export const fitImageForBluesky = async (
  buffer: Buffer,
  mimeType: string
): Promise<FittedBlueskyImage> => {
  const normalized = mimeType.split(';')[0].trim().toLowerCase()
  const metadata = await sharp(buffer, { animated: false }).metadata()
  const isKeptType = KEPT_IMAGE_TYPES.has(normalized as BlueskyImageMimeType)
  const isAnimated = (metadata.pages ?? 1) > 1
  if (
    isKeptType &&
    !isAnimated &&
    buffer.byteLength <= BLUESKY_MAX_IMAGE_BYTES &&
    metadata.width &&
    metadata.height
  ) {
    return {
      bytes: buffer,
      mimeType: normalized as BlueskyImageMimeType,
      width: metadata.width,
      height: metadata.height
    }
  }

  for (const longestSide of [null, ...MAX_LONGEST_SIDES]) {
    for (const quality of JPEG_QUALITIES) {
      const { data, width, height } = await encodeJpeg(
        buffer,
        longestSide,
        quality
      )
      if (data.byteLength <= BLUESKY_MAX_IMAGE_BYTES) {
        return { bytes: data, mimeType: 'image/jpeg', width, height }
      }
    }
  }

  throw new BlueskyImageTooLargeError()
}
