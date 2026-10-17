import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT,
  ACTIVITY_STREAM_PUBLIC_TERM
} from '@/lib/utils/activitystream'

// Mastodon API visibility values
export type MastodonVisibility = 'public' | 'unlisted' | 'private' | 'direct'

// Mastodon accepts all three spellings of the public collection: the full IRI,
// the `as:Public` compact IRI and the bare `Public` term.
const isPublic = (item: string) =>
  item === ACTIVITY_STREAM_PUBLIC ||
  item === ACTIVITY_STREAM_PUBLIC_COMPACT ||
  item === ACTIVITY_STREAM_PUBLIC_TERM

/**
 * Derives the Mastodon visibility from ActivityPub to and cc recipients.
 *
 * Visibility rules:
 * - public: to contains Public
 * - unlisted: cc contains Public (but to doesn't)
 * - private (followers only): to/cc contains followersUrl but no Public
 * - direct: to contains specific user(s) only, no Public or followers
 *
 * @param to - The 'to' recipients array from ActivityPub
 * @param cc - The 'cc' recipients array from ActivityPub
 * @param followersUrl - The author's known followers collection URL, when
 *   available. Servers do not agree on the path (Friendica uses
 *   `/followers/<nick>`), so an exact match on it counts as followers even
 *   when it does not end in `/followers`.
 * @returns The Mastodon visibility string
 */
export const getVisibility = (
  to: string[],
  cc: string[],
  followersUrl?: string | null
): MastodonVisibility => {
  // Public: to contains Public
  if (to.some(isPublic)) {
    return 'public'
  }

  // Unlisted: cc contains Public but to doesn't
  if (cc.some(isPublic)) {
    return 'unlisted'
  }

  // Check if any recipient is a followers URL (typically ends with /followers)
  const hasFollowers = [...to, ...cc].some(
    (item) =>
      (followersUrl ? item === followersUrl : false) ||
      item.endsWith('/followers')
  )

  // Private (followers only): has followers URL but no Public
  if (hasFollowers) {
    return 'private'
  }

  // Direct: specific users only
  return 'direct'
}
