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
