import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import {
  MastodonNotificationType,
  internalTypeToMastodon
} from '@/lib/services/notifications/notificationTypeMapping'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

// Up to how many recent actors to surface per group (Mastodon returns a sample,
// not the full set). Bounds the number of accounts fetched for the envelope.
const SAMPLE_ACCOUNT_LIMIT = 8

// Mastodon NotificationGroup entity (the subset this codebase can populate).
export interface MastodonNotificationGroup {
  group_key: string
  notifications_count: number
  type: MastodonNotificationType
  // Mastodon serializes most_recent_notification_id as a JSON *number* (the
  // numeric notification id), and clients decode it as an integer — the official
  // Mastodon iOS app types it `Int` and crashes on a string. This service uses
  // UUID notification ids, which can't be numbers, so we emit a deterministic
  // integer derived from the group's most-recent notification timestamp. Clients
  // only use this value for display/deep-links (never as a pagination cursor:
  // that's the Link header + the string page_min_id/page_max_id below), so the
  // synthesized number is safe. Keep page_min_id/page_max_id as the real UUID
  // cursors the server can resolve.
  most_recent_notification_id: number
  page_min_id?: string
  page_max_id?: string
  // ISO-8601 timestamp of the group's most recent notification, so clients can
  // display/poll by time (esp. follow-only groups with no backing status, and
  // status-backed groups where the status created_at is the post time, not the
  // interaction time).
  latest_page_notification_at: string
  sample_account_ids: string[]
  status_id?: string
}

export interface NotificationGroupResult {
  group: MastodonNotificationGroup
  // Full source-actor URLs referenced by sample_account_ids, for the envelope
  // to resolve into deduped Account objects.
  sampleActorIds: string[]
  // Full status id referenced by status_id, if any.
  statusId?: string
}

// The stable group key for a grouped notification: the shared groupKey when
// present, otherwise the (ungrouped) notification's own id.
export const notificationGroupKey = (
  notification: GroupedNotification
): string => notification.groupKey || notification.id

/**
 * Builds a Mastodon NotificationGroup from a grouped notification. Pure and
 * synchronous; the caller resolves sampleActorIds/statusId into the envelope's
 * deduped accounts/statuses arrays.
 */
export const getNotificationGroup = (
  notification: GroupedNotification
): NotificationGroupResult => {
  const sampleActorIds = Array.from(
    new Set(notification.groupedActors ?? [notification.sourceActorId])
  ).slice(0, SAMPLE_ACCOUNT_LIMIT)

  return {
    group: {
      group_key: notificationGroupKey(notification),
      notifications_count: notification.groupedCount ?? 1,
      type: internalTypeToMastodon(notification.type),
      // groupNotifications keeps the most recent notification as the base. Its
      // UUID id can't be a JSON number, so derive a stable integer from the
      // most-recent member's createdAt (epoch ms, well within a signed 64-bit
      // int). page_max_id/page_min_id below still carry the real UUID cursors.
      most_recent_notification_id: Math.trunc(notification.createdAt),
      page_max_id: notification.id,
      // groupedIds[last] is the oldest notification in the group (DB returns most-recent-first).
      page_min_id: notification.groupedIds
        ? notification.groupedIds[notification.groupedIds.length - 1]
        : notification.id,
      // groupNotifications keeps the group's createdAt as its most-recent member's.
      latest_page_notification_at: getISOTimeUTC(notification.createdAt),
      sample_account_ids: sampleActorIds.map((id) => urlToId(id)),
      ...(notification.statusId
        ? { status_id: urlToId(notification.statusId) }
        : null)
    },
    sampleActorIds,
    statusId: notification.statusId
  }
}
