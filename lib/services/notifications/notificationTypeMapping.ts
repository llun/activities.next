import { NotificationType } from '@/lib/types/database/operations'

/**
 * Maps a Mastodon notification type name to this codebase's internal
 * NotificationType. Unknown Mastodon types are passed through unchanged and
 * cast — callers use these only for SQL `whereIn`/`whereNotIn`, so a value that
 * matches no row simply filters nothing.
 *
 * Note on `status`: Mastodon's `status` type means "a followed account posted".
 * This codebase has no native follow-post notification, so it is mapped to the
 * closest internal concept, `activity_import`. If a native follow-post
 * notification is ever added, update this mapping.
 */
export const mastodonTypeToInternal = (type: string): NotificationType => {
  switch (type) {
    case 'favourite':
      return NotificationType.enum.like
    case 'reblog':
      return NotificationType.enum.reblog
    case 'status':
      return NotificationType.enum.activity_import
    default:
      return type as NotificationType
  }
}

export const mastodonTypesToInternal = (
  types: string[] | undefined
): NotificationType[] | undefined => types?.map(mastodonTypeToInternal)
