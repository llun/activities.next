import { isSameActivityPubOrigin } from '@/lib/utils/activitypub'
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

// A followers collection: the author's known followers URL, or any recipient
// ending in `/followers` (whoever's collection it is).
export const isFollowersCollection = (
  recipient: string,
  followersUrl?: string | null
) =>
  (Boolean(followersUrl) && recipient === followersUrl) ||
  recipient.endsWith('/followers')

// The author's stored followers URL, only when the author could own it: on the
// author's own origin and not the author's own id. It comes from the remote
// actor document, so a `followers` naming another account (a DM recipient)
// must not turn that account's direct messages into followers-only ones.
// Mastodon's `valid_collection_uri` applies the same same-host rule.
export const getTrustedFollowersUrl = (
  actorId: string,
  followersUrl: string | null | undefined
) =>
  followersUrl &&
  followersUrl !== actorId &&
  isSameActivityPubOrigin(followersUrl, actorId)
    ? followersUrl
    : null

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

  const hasFollowers = [...to, ...cc].some((item) =>
    isFollowersCollection(item, followersUrl)
  )

  // Private (followers only): has followers URL but no Public
  if (hasFollowers) {
    return 'private'
  }

  // Direct: specific users only
  return 'direct'
}

/**
 * `getVisibility` for a status, with its author's followers URL when the
 * author is known and could own it (see `getTrustedFollowersUrl`).
 */
export const getStatusVisibility = (status: {
  actorId: string
  to: string[]
  cc: string[]
  actor?: { followersUrl?: string | null } | null
}): MastodonVisibility =>
  getVisibility(
    status.to,
    status.cc,
    getTrustedFollowersUrl(status.actorId, status.actor?.followersUrl)
  )
