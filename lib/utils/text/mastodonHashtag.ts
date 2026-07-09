// The Mastodon hashtag alphabet: Unicode letters, numbers and underscore.
// Extracted from the featured-tags endpoint (which already accepted Unicode
// names) so the tag timeline — and, in a follow-up PR, /api/v1/tags/:tag plus
// its follow/unfollow routes — validates the same names. The previous
// ASCII-only route regexes 400'd valid Unicode tags like #日本語.
export const MASTODON_HASHTAG_NAME_REGEX = /^[\p{L}\p{N}_]+$/u

export const isMastodonHashtagName = (name: string): boolean =>
  MASTODON_HASHTAG_NAME_REGEX.test(name)

/**
 * Normalize a dynamic route param into a bare, validated hashtag name. The App
 * Router hands path segments over percent-encoded (the same reason other
 * routes call decodeURIComponent on their params), so decode first, then strip
 * a leading `#`. Returns null when the value cannot be decoded or is not a
 * valid Mastodon hashtag name.
 */
export const normalizeHashtagParam = (param: string): string | null => {
  let decoded: string
  try {
    decoded = decodeURIComponent(param)
  } catch {
    return null
  }
  const name = decoded.replace(/^#+/, '')
  return isMastodonHashtagName(name) ? name : null
}
