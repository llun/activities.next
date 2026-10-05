type StatusAudience = { to: string[]; cc: string[] }

/**
 * True when `after` addresses anyone `before` did not (direct → public,
 * followers-only → unlisted, a newly mentioned actor). A status's prior
 * revisions were written for `before`, and `status_history` does not record
 * that audience, so a widening change must drop them rather than let the new
 * audience read text and media written for a narrower one.
 */
export const widensStatusAudience = (
  before: StatusAudience,
  after: StatusAudience
): boolean => {
  const previous = new Set([...before.to, ...before.cc])
  return [...after.to, ...after.cc].some(
    (recipient) => !previous.has(recipient)
  )
}
