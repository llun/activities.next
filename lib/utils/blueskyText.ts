// Bluesky post length rules, shared between the server reply service and
// browser composers. Keep this module browser-safe (no Node/server imports).

export const BLUESKY_MAX_GRAPHEMES = 300

export const BLUESKY_TOO_LONG_MESSAGE =
  'Bluesky allows 300 characters. Shorten the reply to post it.'

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme'
})

/** Counts user-perceived characters (Unicode grapheme clusters), as Bluesky does. */
export const countBlueskyGraphemes = (text: string): number => {
  let count = 0
  for (const _ of graphemeSegmenter.segment(text)) {
    count += 1
  }
  return count
}
