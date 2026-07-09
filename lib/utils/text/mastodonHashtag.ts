// The Mastodon hashtag alphabet: Unicode letters, numbers and underscore.
// Extracted from the featured-tags endpoint (which already accepted Unicode
// names) so the tag timeline — and, in a follow-up PR, /api/v1/tags/:tag plus
// its follow/unfollow routes — validates the same names. The previous
// ASCII-only route regexes 400'd valid Unicode tags like #日本語.
export const MASTODON_HASHTAG_NAME_REGEX = /^[\p{L}\p{N}_]+$/u

// The real hashtag-name limit, matching the `followed_tags.name varchar(255)`
// column. Enforced on the *decoded* name (see normalizeHashtagParam).
export const MAX_HASHTAG_NAME_LENGTH = 255

// Upper bound for the *raw* (still percent-encoded) path param before decoding.
// A single Unicode codepoint in the hashtag alphabet is up to 4 UTF-8 bytes,
// and each byte percent-encodes to 3 chars, so a valid 255-codepoint name can
// be up to 255 * 4 * 3 = 3060 encoded chars; 4096 leaves margin for a leading
// `#`. Capping the raw param on 255 (as the decoded limit) would prematurely
// 400 valid Unicode tags like #日本語 (9 encoded chars per character); the
// decoded name is what must obey MAX_HASHTAG_NAME_LENGTH. Still bounded so an
// unbounded param can't reach decodeURIComponent.
export const MAX_ENCODED_HASHTAG_PARAM_LENGTH = 4096

export const isMastodonHashtagName = (name: string): boolean =>
  MASTODON_HASHTAG_NAME_REGEX.test(name)

/**
 * Normalize a dynamic route param into a bare, validated hashtag name. The App
 * Router hands path segments over percent-encoded (the same reason other
 * routes call decodeURIComponent on their params), so decode first, then strip
 * a leading `#`. Returns null when the value cannot be decoded, exceeds the
 * decoded length limit, or is not a valid Mastodon hashtag name.
 */
export const normalizeHashtagParam = (param: string): string | null => {
  let decoded: string
  try {
    decoded = decodeURIComponent(param)
  } catch {
    return null
  }
  const name = decoded.replace(/^#+/, '')
  return name.length <= MAX_HASHTAG_NAME_LENGTH && isMastodonHashtagName(name)
    ? name
    : null
}
