import { CustomEmojiData } from '@/lib/types/domain/customEmoji'

// Matches `:shortcode:` tokens in status text, mirroring Mastodon's
// `CustomEmoji::SCAN_RE`: a `[a-zA-Z0-9_]{2,}` shortcode (minimum two
// characters, like Mastodon) with a non-alphanumeric, non-colon boundary on
// each side, so a shortcode embedded in a word (e.g. `foo:bar:baz`) is not
// treated as an emoji and we federate exactly the tokens Mastodon would render.
export const EMOJI_SHORTCODE_REGEX =
  /(?<![A-Za-z0-9:]):([a-zA-Z0-9_]{2,}):(?![A-Za-z0-9:])/g

// A stored emoji tag's `name` is whatever an inbound `Emoji` tag said — the AP
// schema asks only for `z.string()` — so it has to be normalized before it can
// be looked up, and rejected if it cannot be a shortcode at all.
//
// DELIBERATELY more tolerant than the local scanner above. Mastodon's
// `[a-zA-Z0-9_]{2,}` describes what Mastodon MINTS, not what the fediverse
// sends, and applying it to inbound tags silently deleted real emoji: sampling
// two live instances, 275 of 13,399 shortcodes on a Pleroma server and 75 of
// 3,403 on an Akkoma one fail it — `:poi-love:` and `:femboy-cat:` (hyphens,
// which Sharkey allows on purpose), `:c:` and `:3:` (one character, which
// GoToSocial and Misskey both permit), `:gutkato_afiŝo_miaŭ:` (non-ASCII).
// Pleroma and Akkoma derive shortcodes from emoji-pack filenames and never
// validate the outbound name at all.
//
// Colons are optional because Friendica sends the name BARE (`"like"`) while
// its post body still carries `:like:`; every other implementation wraps them.
// Normalizing both spellings to the token form is what Mastodon, GoToSocial and
// Iceshrimp all do on ingest.
//
// What is excluded is only what cannot work or cannot be trusted: a colon or
// whitespace inside the name (it could never be matched as one token), and the
// control and format characters, which are invisible and so are a way to make
// two different shortcodes look identical.
const MAX_EMOJI_SHORTCODE_LENGTH = 64
const UNUSABLE_SHORTCODE_CHARACTERS = /[\s:]|\p{Cc}|\p{Cf}/u

/**
 * The `:shortcode:` token to look for in status text for a stored emoji tag's
 * name, or null when the name cannot be a shortcode.
 */
export const toEmojiShortcodeToken = (name: string): string | null => {
  const inner =
    name.length >= 2 && name.startsWith(':') && name.endsWith(':')
      ? name.slice(1, -1)
      : name
  if (!inner || inner.length > MAX_EMOJI_SHORTCODE_LENGTH) return null
  if (UNUSABLE_SHORTCODE_CHARACTERS.test(inner)) return null
  return `:${inner}:`
}

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
