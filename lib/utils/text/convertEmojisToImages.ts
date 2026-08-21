import { Tag } from '@/lib/types/domain/tag'
import { escapeHtml } from '@/lib/utils/text/escapeHtml'
import { isEmojiShortcodeName } from '@/lib/utils/text/getEmojiTags'

/**
 * Replaces each `:shortcode:` token with the custom-emoji image it names.
 *
 * Both halves of every tag are untrusted on the REMOTE path: `createNoteJob`
 * persists an inbound `Emoji` tag's `name` and `icon.url` verbatim, and the AP
 * schema asks only for `z.string()`. (The local path is safe by construction —
 * `getEmojiTags` resolves `:shortcode:` tokens against this instance's own
 * emoji table.) This runs BETWEEN the two sanitize passes, so whatever it
 * splices in is markup the first pass has already approved and the second will
 * keep if the allowlist permits it.
 *
 * That makes both interpolations injection points, and they need different
 * defences because they are used in different ways:
 *
 *   `value` is only ever written INTO the markup, so escaping it is enough. It
 *   used to go in raw, and a `"` in the url closed the `src` attribute and made
 *   the rest of the value live markup — enough to wrap a link in
 *   `<span class="invisible">`, which `cleanClassName` renders as
 *   `display: none`. The post then showed no such link while still getting a
 *   preview card for it.
 *
 *   `name` is ALSO the replace target, matched literally against the rendered
 *   HTML. Escaping the `alt` does nothing about that: a name shaped like
 *   `<a href="…">` matches the post's own anchor and consumes it, so the reader
 *   loses a link that the extractor had already picked. Rejecting anything that
 *   is not a real shortcode is the only fix that covers it, and it is
 *   independently worth having — an unconstrained name like `e` would replace
 *   every `e` in the post.
 *
 * A rejected tag renders as nothing at all: the literal `:shortcode:` stays in
 * the text, which is what a reader on a server that does not have the emoji
 * sees anyway.
 */
export const convertEmojisToImages = (text: string, tags: Tag[]) =>
  tags
    .filter((tag) => tag.type === 'emoji' && isEmojiShortcodeName(tag.name))
    .reduce(
      (replaceText, tag) =>
        replaceText.replaceAll(
          tag.name,
          `<img class="emoji" src="${escapeHtml(tag.value)}" alt="${escapeHtml(tag.name)}"></img>`
        ),
      text
    )
