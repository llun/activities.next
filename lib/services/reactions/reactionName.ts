// Reaction-name handling for *local* writes.
//
// Inbound federation stays deliberately liberal (senders disagree about what a
// reaction may be, and storage is opaque — see lib/actions/emojiReaction), but a
// reaction this instance originates has to be something we can actually render
// and federate, so it is validated here before it is stored.

// One grapheme cluster is the unit a reaction is measured in: a flag is a
// regional-indicator pair, a family is several code points joined by ZWJ, and a
// skin-toned hand carries a modifier — all a single user-perceived character.
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme'
})

// A keycap (`1\u{FE0F}\u{20E3}`) is built from an ASCII digit plus the enclosing
// combiner, so none of the emoji properties match it — match the combiner
// itself. It can only appear inside a keycap sequence, and the single-grapheme
// check above already rules out a bare digit.
const EMOJI_CODE_POINT =
  /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Regional_Indicator}|\u{20E3}/u

/**
 * Whether `value` is a single emoji grapheme — the unicode half of what a
 * reaction may be. Rejects plain letters and digits (which are `Emoji` but not
 * `Emoji_Presentation`, and are how a shortcode is spelled) and anything longer
 * than one grapheme.
 */
export const isUnicodeEmojiReaction = (value: string): boolean => {
  const graphemes = [...graphemeSegmenter.segment(value)]
  if (graphemes.length !== 1) return false
  return EMOJI_CODE_POINT.test(value)
}

// A custom-emoji reference, written either `:shortcode:` or bare. Matches the
// shortcode grammar the admin emoji form and the picker use.
const SHORTCODE = /^[A-Za-z0-9_]+$/

/**
 * The custom-emoji shortcode `value` names, or null when it is not a shortcode
 * reference. Colons are stripped: they are how the emoji is *written*, never how
 * it is stored.
 */
export const getCustomEmojiShortcode = (value: string): string | null => {
  const shortcode =
    value.startsWith(':') && value.endsWith(':') && value.length > 2
      ? value.slice(1, -1)
      : value
  return SHORTCODE.test(shortcode) ? shortcode : null
}
