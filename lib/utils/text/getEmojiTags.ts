import { CustomEmojiData } from '@/lib/types/domain/customEmoji'

// Matches `:shortcode:` tokens in status text, mirroring Mastodon's
// `CustomEmoji::SCAN_RE`: a `[a-zA-Z0-9_]{2,}` shortcode (minimum two
// characters, like Mastodon) with a non-alphanumeric, non-colon boundary on
// each side, so a shortcode embedded in a word (e.g. `foo:bar:baz`) is not
// treated as an emoji and we federate exactly the tokens Mastodon would render.
export const EMOJI_SHORTCODE_REGEX =
  /(?<![A-Za-z0-9:]):([a-zA-Z0-9_]{2,}):(?![A-Za-z0-9:])/g

export interface ResolvedEmojiTag {
  name: string
  value: string
}

// Scans `text` for `:shortcode:` tokens and resolves each one against the
// supplied instance custom-emoji set. Returns the emoji domain-tag fields
// (`name = ':shortcode:'`, `value = image url`) for every distinct matching
// shortcode, ready to persist via `createTag({ type: 'emoji' })`. Unknown
// shortcodes are ignored.
export const getEmojiTags = (
  text: string,
  emojis: Pick<CustomEmojiData, 'shortcode' | 'url'>[]
): ResolvedEmojiTag[] => {
  if (!text) return []
  const emojiByShortcode = new Map(
    emojis.map((emoji) => [emoji.shortcode, emoji])
  )
  const seen = new Set<string>()
  const tags: ResolvedEmojiTag[] = []
  for (const match of text.matchAll(EMOJI_SHORTCODE_REGEX)) {
    const shortcode = match[1]
    if (seen.has(shortcode)) continue
    const emoji = emojiByShortcode.get(shortcode)
    if (!emoji) continue
    seen.add(shortcode)
    tags.push({ name: `:${shortcode}:`, value: emoji.url })
  }
  return tags
}
