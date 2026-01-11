import { Mastodon } from '@llun/activities.schema'

import { Database } from '@/lib/database/types'
import {
  Notification,
  NotificationType
} from '@/lib/database/types/notification'
import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'

import { getMastodonStatus } from '../mastodon/getMastodonStatus'

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
  | 'admin.sign_up'
  | 'admin.report'

export interface MastodonNotification {
  id: string
  type: MastodonNotificationType
  created_at: string
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
  options?: { includeGrouping?: boolean; currentActorId?: string }
): Promise<MastodonNotification | null> => {
  const { includeGrouping = false, currentActorId } = options || {}

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
      status = mastodonStatus || undefined
    }
  }

  // Base notification
  const mastodonNotification: MastodonNotification = {
    id: notification.id,
    type: mapNotificationType(notification.type),
    created_at: new Date(notification.createdAt).toISOString(),
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
        (acc): acc is Mastodon.Account => acc !== null
      )
    }
  }

  return mastodonNotification
}
