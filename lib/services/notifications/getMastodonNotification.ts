import { Database } from '@/lib/database/types'
import { applyFiltersToStatus } from '@/lib/services/filters/applyFilters'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import { Mastodon } from '@/lib/types/activitypub'
import {
  ActiveFilterRecord,
  Notification,
  NotificationType
} from '@/lib/types/database/operations'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

// Mastodon notification type mapping
type MastodonNotificationType =
  | 'mention'
  | 'status'
  | 'reblog'
  | 'follow'
  | 'follow_request'
  | 'favourite'
  | 'poll'
  | 'update'
  | 'added_to_collection'
  | 'collection_update'
  | 'admin.sign_up'
  | 'admin.report'

export interface MastodonNotification {
  id: string
  type: MastodonNotificationType
  created_at: string
  // The stable grouping key: the stored groupKey for groupable notifications,
  // else `ungrouped-<id>` — the same value the v2 grouped API addresses
  // groups by.
  group_key: string
  account: Mastodon.Account
  status?: Mastodon.Status
  // Non-standard fields for grouping support (backward compatibility)
  grouped_count?: number
  grouped_accounts?: Mastodon.Account[]
}

/**
 * Map internal notification type to Mastodon API type
 */
const mapNotificationType = (
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
    case 'added_to_collection':
      return 'added_to_collection'
    case 'collection_update':
      return 'collection_update'
    default:
      return 'mention' // Default fallback
  }
}

/**
 * Transform internal notification to Mastodon-compatible format
 */
export const getMastodonNotification = async (
  database: Database,
  notification: Notification | GroupedNotification,
  options?: {
    includeGrouping?: boolean
    currentActorId?: string
    filterRecords?: ActiveFilterRecord[]
  }
): Promise<MastodonNotification | null> => {
  const {
    includeGrouping = false,
    currentActorId,
    filterRecords
  } = options || {}

  // Fetch account
  const account = await database.getMastodonActorFromId({
    id: notification.sourceActorId
  })

  if (!account) {
    return null
  }

  // Fetch status if present
  let status: Mastodon.Status | undefined
  if (notification.statusId) {
    const statusData = await database.getStatus({
      statusId: notification.statusId,
      withReplies: false
    })
    if (statusData) {
      const mastodonStatus = await getMastodonStatus(
        database,
        statusData,
        currentActorId
      )
      if (mastodonStatus) {
        if (filterRecords && filterRecords.length > 0) {
          const matches = applyFiltersToStatus(statusData, filterRecords)
          if (matches.some((match) => match.filter.filter_action === 'hide')) {
            return null
          }
          if (matches.length > 0) {
            if (mastodonStatus.reblog) {
              status = {
                ...mastodonStatus,
                reblog: { ...mastodonStatus.reblog, filtered: matches }
              }
            } else {
              status = { ...mastodonStatus, filtered: matches }
            }
          } else {
            status = mastodonStatus
          }
        } else {
          status = mastodonStatus
        }
      }
    }
  }

  // Base notification
  const mastodonNotification: MastodonNotification = {
    id: notification.id,
    type: mapNotificationType(notification.type),
    created_at: getISOTimeUTC(notification.createdAt),
    group_key: notification.groupKey ?? `ungrouped-${notification.id}`,
    account,
    status
  }

  // Include grouping fields if enabled and notification is grouped
  if (
    includeGrouping &&
    'groupedActors' in notification &&
    notification.groupedActors
  ) {
    mastodonNotification.grouped_count = notification.groupedCount || 1

    // Fetch grouped accounts (up to 3)
    if (notification.groupedActors.length > 1) {
      const groupedAccounts = await Promise.all(
        notification.groupedActors
          .slice(0, 3)
          .map((actorId) => database.getMastodonActorFromId({ id: actorId }))
      )
      mastodonNotification.grouped_accounts = groupedAccounts.filter(
        (acc: Mastodon.Account | null): acc is Mastodon.Account => acc !== null
      )
    }
  }

  return mastodonNotification
}
