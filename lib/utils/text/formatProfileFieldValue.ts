import { escapeHtml } from '@/lib/utils/text/escapeHtml'

// Mastodon splits a link's visible text after this many characters, hides the
// rest in a trailing `invisible` span and marks the cut with `ellipsis`.
const LINK_DISPLAY_LENGTH = 30
const URL_PREFIX_PATTERN = /^https?:\/\/(www\.)?/i

const getHttpUrl = (value: string): string | null => {
  if (/\s/.test(value)) return null
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

/**
 * The HTML form of one profile metadata field value, for the actor's
 * `PropertyValue` attachment and the Account entity's `fields[].value`.
 *
 * A deliberate subset of Mastodon's TextFormatter: only a value that is
 * exactly one http(s) URL becomes a link (the link markup is Mastodon's: scheme
 * and `www.` in a leading invisible span, a long address cut with an ellipsis),
 * because that is what `rel="me"` verification needs. URLs, mentions and
 * hashtags inside other text stay plain text; every other value is
 * HTML-escaped plain text.
 *
 * The input is the raw text the owner typed and the output is HTML built only
 * from escaped parts, so it needs no further sanitising. A remote actor's
 * stored value is already HTML and must not go through here.
 */
export const formatProfileFieldValue = (rawValue: string): string => {
  const value = rawValue.trim()
  const url = getHttpUrl(value)
  if (!url) return escapeHtml(value)

  const prefix = url.match(URL_PREFIX_PATTERN)?.[0] ?? ''
  // Cut by code point, so an emoji or other astral character is never split
  // into a lone surrogate.
  const rest = Array.from(url.slice(prefix.length))
  const display = rest.slice(0, LINK_DISPLAY_LENGTH).join('')
  const hidden = rest.slice(LINK_DISPLAY_LENGTH).join('')
  const className = hidden.length > 0 ? 'ellipsis' : ''
  return (
    `<a href="${escapeHtml(url)}" target="_blank" rel="nofollow noopener me" translate="no">` +
    `<span class="invisible">${escapeHtml(prefix)}</span>` +
    `<span class="${className}">${escapeHtml(display)}</span>` +
    `<span class="invisible">${escapeHtml(hidden)}</span></a>`
  )
}
