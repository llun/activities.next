import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

// Mastodon API visibility values
export type MastodonVisibility = 'public' | 'unlisted' | 'private' | 'direct'

const isPublic = (item: string) =>
  item === ACTIVITY_STREAM_PUBLIC || item === ACTIVITY_STREAM_PUBLIC_COMPACT

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
 * @returns The Mastodon visibility string
 */
export const getVisibility = (
  to: string[],
  cc: string[]
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
  const hasFollowers = [...to, ...cc].some((item) =>
    item.endsWith('/followers')
  )

  // Private (followers only): has followers URL but no Public
  if (hasFollowers) {
    return 'private'
  }

  // Direct: specific users only
  return 'direct'
}
