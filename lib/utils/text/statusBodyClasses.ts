// Class predicates shared by the status body renderer (`cleanClassName`) and
// the plain-text flattening that reads the same markup (`htmlToPlainText`).
// Which tags each class applies to is decided by each caller.

export const hasToken = (value: string | undefined, token: string): boolean =>
  value?.split(/\s+/).includes(token) ?? false

// Mastodon wraps the scheme and the tail of a long link in `invisible`, and
// marks the cut with `ellipsis`; the body hides the former and appends "…".
export const isInvisibleClass = (value: string | undefined): boolean =>
  value === 'invisible'

export const isEllipsisClass = (value: string | undefined): boolean =>
  value === 'ellipsis'

export const isQuoteInlineClass = (value: string | undefined): boolean =>
  hasToken(value, 'quote-inline')
