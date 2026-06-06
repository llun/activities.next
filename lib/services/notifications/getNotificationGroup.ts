import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import {
  MastodonNotificationType,
  internalTypeToMastodon
} from '@/lib/services/notifications/notificationTypeMapping'
import { getMastodonTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

// Up to how many recent actors to surface per group (Mastodon returns a sample,
// not the full set). Bounds the number of accounts fetched for the envelope.
const SAMPLE_ACCOUNT_LIMIT = 8

// Mastodon NotificationGroup entity (the subset this codebase can populate).
export interface MastodonNotificationGroup {
  group_key: string
  notifications_count: number
  type: MastodonNotificationType
  most_recent_notification_id: string
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
      // groupNotifications keeps the most recent notification as the base.
      most_recent_notification_id: notification.id,
      page_max_id: notification.id,
      // groupedIds[last] is the oldest notification in the group (DB returns most-recent-first).
      page_min_id: notification.groupedIds
        ? notification.groupedIds[notification.groupedIds.length - 1]
        : notification.id,
      // groupNotifications keeps the group's createdAt as its most-recent member's.
      latest_page_notification_at: getMastodonTimeUTC(notification.createdAt),
      sample_account_ids: sampleActorIds.map((id) => urlToId(id)),
      ...(notification.statusId
        ? { status_id: urlToId(notification.statusId) }
        : null)
    },
    sampleActorIds,
    statusId: notification.statusId
  }
}
