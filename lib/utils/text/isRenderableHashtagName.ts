// A hashtag name the in-app hashtag timeline (app/(timeline)/tags/[tag]) can
// render: ASCII word characters with at least one letter or underscore. This
// mirrors that route's TAG_REGEX and the in-post hashtag tokenizer, and is
// intentionally stricter than the server's Mastodon featured-tag regex
// (`^[\p{L}\p{N}_]+$`, which also allows Unicode and all-numeric names). A name
// that fails this can be created via the raw Mastodon API but cannot be linked
// to /tags/<name> without 404ing, so callers should both block creating it and
// avoid linking it.
export const RENDERABLE_HASHTAG_NAME_REGEX =
  /^[a-zA-Z0-9_]*[a-zA-Z_][a-zA-Z0-9_]*$/

export const isRenderableHashtagName = (name: string): boolean =>
  RENDERABLE_HASHTAG_NAME_REGEX.test(name)
