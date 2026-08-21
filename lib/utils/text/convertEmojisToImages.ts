import { Tag } from '@/lib/types/domain/tag'
import { escapeHtml } from '@/lib/utils/text/escapeHtml'
import { toEmojiShortcodeToken } from '@/lib/utils/text/getEmojiTags'

// A `:shortcode:` token as it appears in text: a colon, then anything that is
// not a colon or whitespace, then a colon. It has to be at least as wide as
// `toEmojiShortcodeToken` — anything that normalizer accepts must be findable
// here, or the tag resolves to nothing. It is deliberately a little wider (it
// will match tokens containing characters the normalizer rejects), which costs
// nothing: resolution is a map lookup, so a token no tag resolves is left in
// the text untouched.
//
// Deliberately not Mastodon's `[a-zA-Z0-9_]{2,}` either — see the note there.
//
// The length bound must not be lower than `MAX_EMOJI_SHORTCODE_LENGTH`; a
// coupling test pins the two together.
const SHORTCODE_TOKEN_REGEX = /:[^\s:]{1,64}:/g

// Splits already-sanitized HTML into alternating text and tag pieces, keeping
// the tags (the capture group). Sound because the input has been through
// `sanitizeText`, which escapes `<` and `>` everywhere they are not tag
// delimiters — including inside attribute values, where `>` comes out as
// `&gt;`. So a piece starting with `<` is a tag and nothing else can be.
const HTML_TAG_SPLIT_REGEX = /(<[^>]*>)/

/**
 * Replaces each `:shortcode:` token in status text with the custom-emoji image
 * it names.
 *
 * Both halves of every tag are untrusted on the REMOTE path: `createNoteJob`
 * persists an inbound `Emoji` tag's `name` and `icon.url` verbatim, and the AP
 * schema asks only for `z.string()`. (The local path is safe by construction —
 * `getEmojiTags` resolves tokens against this instance's own emoji table.) This
 * runs BETWEEN the two sanitize passes, so whatever it splices in is markup the
 * first pass has already approved and the second will keep if the allowlist
 * permits it. Four separate things went wrong here; each line below is one.
 *
 * What is searched for is a shortcode-shaped TOKEN, never the stored name. The
 * name used to be the search string itself, which escaping its output could
 * never fix: a name shaped like `<a href="…">` matched the post's own anchor
 * and consumed it, and an unconstrained one like `e` would replace every `e` in
 * the post. Matching a fixed token shape and looking the name up afterwards is
 * what closes that, and it is why a hostile name is now harmless rather than
 * merely rejected — nothing can find it. `toEmojiShortcodeToken` is doing more
 * than filtering, though: it NORMALIZES, which is what lets a server that sends
 * the name bare (Friendica sends `like` while its body says `:like:`) resolve
 * at all.
 *
 * The substitution is a single pass over the original text, not a reduce that
 * feeds each result into the next. Every replacement writes an
 * `alt=":shortcode:"` of its own, so re-scanning let one tag match another's
 * output and nest markup inside an attribute.
 *
 * Only the TEXT pieces are touched. A `:` survives sanitization inside an href,
 * so substituting blindly rewrote the very link a preview card was for — the
 * reader was left with a corrupted url while the card still named the original.
 * That one needed no hostile input at all: an ordinary custom emoji plus any
 * link with a `:word:` path segment did it.
 *
 * The replacement is a FUNCTION, which is what makes `$` literal. A string
 * replacement re-reads `$&` and "$`" AFTER escaping, so a url carrying those
 * spliced raw `<`, `>` and `"` from elsewhere in the post into the src
 * attribute — characters `escapeHtml` never saw, because they were never in the
 * url.
 *
 * A rejected tag renders as nothing: the literal `:shortcode:` stays in the
 * text, which is what a reader on a server lacking that emoji sees anyway.
 */
export const convertEmojisToImages = (text: string, tags: Tag[]) => {
  const urlByShortcode = new Map<string, string>()
  for (const tag of tags) {
    if (tag.type !== 'emoji') continue
    const token = toEmojiShortcodeToken(tag.name)
    if (!token) continue
    // First one wins, so a repeated shortcode resolves the same way wherever it
    // appears rather than depending on which occurrence is being replaced.
    if (!urlByShortcode.has(token)) urlByShortcode.set(token, tag.value)
  }
  if (urlByShortcode.size === 0) return text

  return text
    .split(HTML_TAG_SPLIT_REGEX)
    .map((piece) =>
      piece.startsWith('<')
        ? piece
        : piece.replaceAll(SHORTCODE_TOKEN_REGEX, (token) => {
            const url = urlByShortcode.get(token)
            if (url === undefined) return token
            return `<img class="emoji" src="${escapeHtml(url)}" alt="${escapeHtml(token)}"></img>`
          })
    )
    .join('')
}
