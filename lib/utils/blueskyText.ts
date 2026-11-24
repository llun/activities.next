// Bluesky post length rules, shared between the server reply service and
// browser composers. Keep this module browser-safe (no Node/server imports).

export const BLUESKY_MAX_GRAPHEMES = 300
export const BLUESKY_MAX_UTF8_BYTES = 3000

export const BLUESKY_TOO_LONG_MESSAGE =
  'Bluesky allows 300 characters. Shorten the reply to post it.'

export const BLUESKY_REPLY_POSTED_NOT_STORED_MESSAGE =
  'Your reply is on Bluesky. It will show here after the next sync.'

export const BLUESKY_REPLY_QUEUE_DISABLED_REASON =
  'Bluesky replies are posted right away, not queued.'

export const BLUESKY_REPLY_ATTACHMENTS_BLOCKED_MESSAGE =
  'Images in Bluesky replies are not supported yet. Remove them to post.'

export const BLUESKY_CROSSPOST_CUT_MESSAGE =
  "Longer than Bluesky's 300 characters: the Bluesky copy is cut at a sentence end, with a link to this post."

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme'
})
const textEncoder = new TextEncoder()

/** Counts user-perceived characters (Unicode grapheme clusters), as Bluesky does. */
export const countBlueskyGraphemes = (text: string): number => {
  let count = 0
  for (const _ of graphemeSegmenter.segment(text)) {
    count += 1
  }
  return count
}

/** Counts UTF-8 bytes, matching Bluesky's 3000-byte record limit. */
export const countBlueskyUtf8Bytes = (text: string): number =>
  textEncoder.encode(text).byteLength

export interface BlueskyReplyLengthState {
  remaining: number
  overBlueskyLimit: boolean
  overInstanceLimit: boolean
  withinLimits: boolean
  errorMessage: string | null
}

/**
 * Evaluates a Bluesky reply against both the instance `.length` limit and
 * Bluesky's 300-grapheme / 3000-byte limits.
 */
export const getBlueskyReplyLengthState = (
  text: string,
  maxStatusCharacters: number
): BlueskyReplyLengthState => {
  const graphemes = countBlueskyGraphemes(text)
  const utf8Bytes = countBlueskyUtf8Bytes(text)
  const overBlueskyLimit =
    graphemes > BLUESKY_MAX_GRAPHEMES || utf8Bytes > BLUESKY_MAX_UTF8_BYTES
  const overInstanceLimit = text.length > maxStatusCharacters
  const remaining = Math.min(
    maxStatusCharacters - text.length,
    BLUESKY_MAX_GRAPHEMES - graphemes
  )

  let errorMessage: string | null = null
  if (
    overInstanceLimit &&
    (!overBlueskyLimit || maxStatusCharacters < BLUESKY_MAX_GRAPHEMES)
  ) {
    errorMessage = `Text character limit of ${maxStatusCharacters} exceeded`
  } else if (overBlueskyLimit) {
    errorMessage = BLUESKY_TOO_LONG_MESSAGE
  }

  return {
    remaining,
    overBlueskyLimit,
    overInstanceLimit,
    withinLimits: !overBlueskyLimit && !overInstanceLimit,
    errorMessage
  }
}

/**
 * Whether a cross-post of this text would be cut. Counts the raw text: the
 * server strips Markdown markers first, so this can warn early (and the
 * warning never blocks posting).
 *
 * The server also appends a link to the original post for a poll
 * (`Vote here: <url>`), a quote of a fediverse post, a content warning and
 * dropped media. Pass the link the composer knows as `appendedLink` so those
 * cases warn too. A content warning replaces the text with the summary, so it
 * never cuts; dropped media is not predicted here.
 */
export const isOverBlueskyLimit = (
  text: string,
  appendedLink?: string | null
): boolean => {
  const full = appendedLink ? `${text}\n\n${appendedLink}` : text
  return (
    countBlueskyUtf8Bytes(full) > BLUESKY_MAX_UTF8_BYTES ||
    countBlueskyGraphemes(full) > BLUESKY_MAX_GRAPHEMES
  )
}
