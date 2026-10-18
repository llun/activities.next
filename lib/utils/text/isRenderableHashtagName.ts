import { MAX_HASHTAG_NAME_LENGTH } from './mastodonHashtag'

// A hashtag name the in-app hashtag timeline (app/(timeline)/tags/[tag]) can
// render: ASCII word characters with at least one letter or underscore. This
// is what that route checks, and mirrors the in-post hashtag tokenizer. It is
// intentionally stricter than the server's Mastodon featured-tag regex
// (`^[\p{L}\p{N}_]+$`, which also allows Unicode and all-numeric names). A name
// that fails this can be created via the raw Mastodon API but cannot be linked
// to /tags/<name> without 404ing, so callers should both block creating it and
// avoid linking it. Written with a digits-only prefix: the equivalent
// `[a-zA-Z0-9_]*[a-zA-Z_][a-zA-Z0-9_]*` backtracks quadratically on a long name
// that fails (see `extractTagFromHref` in `cleanClassName.ts`).
export const RENDERABLE_HASHTAG_NAME_REGEX = /^[0-9]*[a-zA-Z_][a-zA-Z0-9_]*$/

// The length is checked first: a name over the stored hashtag limit is not a
// tag, and the public tags page passes this the raw URL segment.
export const isRenderableHashtagName = (name: string): boolean =>
  name.length <= MAX_HASHTAG_NAME_LENGTH &&
  RENDERABLE_HASHTAG_NAME_REGEX.test(name)
