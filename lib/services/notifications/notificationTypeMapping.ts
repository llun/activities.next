import { NotificationType } from '@/lib/types/database/operations'

/**
 * Maps a Mastodon notification type name to this codebase's internal
 * NotificationType values. Returns an array because some Mastodon types cover
 * multiple internal types: Mastodon `mention` maps to both internal `mention`
 * and `reply` since both are serialised as `mention` in the Mastodon API.
 * Unknown Mastodon types are passed through unchanged and cast — callers use
 * these for SQL `whereIn`/`whereNotIn`, so an unrecognised value matches zero
 * rows.
 *
 * Note on `status`: Mastodon's `status` type means "a followed account posted".
 * This codebase has no native follow-post notification, so it is mapped to the
 * closest internal concept, `activity_import`. If a native follow-post
 * notification is ever added, update this mapping.
 */
export const mastodonTypeToInternal = (type: string): NotificationType[] => {
  switch (type) {
    case 'favourite':
      return [NotificationType.enum.like]
    case 'reblog':
      return [NotificationType.enum.reblog]
    case 'status':
      return [NotificationType.enum.activity_import]
    case 'mention':
      return [NotificationType.enum.mention, NotificationType.enum.reply]
    default:
      return [type as NotificationType]
  }
}

export const mastodonTypesToInternal = (
  types: string[] | undefined
): NotificationType[] | undefined => {
  if (!types) return undefined
  return [...new Set(types.flatMap(mastodonTypeToInternal))]
}

// Mastodon notification entity type names.
export type MastodonNotificationType =
  | 'mention'
  | 'status'
  | 'reblog'
  | 'follow'
  | 'follow_request'
  | 'favourite'
  | 'poll'
  | 'update'
  | 'admin.sign_up'
  | 'admin.report'

/**
 * Maps this codebase's internal NotificationType to the Mastodon entity type.
 * Inverse direction of mastodonTypeToInternal (see the `status` note there).
 */
export const internalTypeToMastodon = (
  type: NotificationType
): MastodonNotificationType => {
  switch (type) {
    case 'like':
      return 'favourite'
    case 'reply':
      return 'mention'
    case 'reblog':
      return 'reblog'
    case 'follow':
      return 'follow'
    case 'follow_request':
      return 'follow_request'
    case 'mention':
      return 'mention'
    case 'activity_import':
      return 'status'
    default:
      return 'mention'
  }
}
