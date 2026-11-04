import { isPubliclyAddressed } from '@/lib/database/domains/status/status'

type StatusAudience = { to: string[]; cc: string[] }

/**
 * True when `after` addresses anyone `before` did not (direct → public,
 * followers-only → unlisted, a newly mentioned actor). A status's prior
 * revisions were written for `before`, and `status_history` does not record
 * that audience, so a widening change must drop them rather than let the new
 * audience read text and media written for a narrower one.
 *
 * A change between two publicly addressed audiences is not a widening: public
 * and unlisted both let anyone read the status, so the prior revisions were
 * already readable by the same people and stay — including when the edit only
 * adds a newly mentioned recipient.
 */
export const widensStatusAudience = (
  before: StatusAudience,
  after: StatusAudience
): boolean => {
  if (isPubliclyAddressed(before) && isPubliclyAddressed(after)) return false
  const previous = new Set([...before.to, ...before.cc])
  return [...after.to, ...after.cc].some(
    (recipient) => !previous.has(recipient)
  )
}
