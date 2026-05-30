import { Notification, NotificationType } from '@/lib/types/database/operations'

export interface GroupedNotification extends Notification {
  groupedActors?: string[]
  groupedCount?: number
  groupedIds?: string[]
}

export const groupNotifications = (
  notifications: Notification[],
  enableGrouping: boolean = true,
  groupedTypes?: Set<NotificationType>
): GroupedNotification[] => {
  // If grouping is disabled, return each notification as its own group.
  if (!enableGrouping) {
    return notifications.map((notification) => ({
      ...notification,
      groupKey: `ungrouped-${notification.id}`,
      groupedActors: undefined,
      groupedCount: 1,
      groupedIds: undefined
    }))
  }

  const groups: Map<string, GroupedNotification> = new Map()

  for (const notification of notifications) {
    const canGroup =
      notification.groupKey &&
      (!groupedTypes || groupedTypes.has(notification.type))

    if (canGroup) {
      const existing = groups.get(notification.groupKey!)
      if (existing) {
        // Add to existing group
        if (!existing.groupedActors) {
          existing.groupedActors = [existing.sourceActorId]
        }
        existing.groupedActors.push(notification.sourceActorId)
        existing.groupedCount = (existing.groupedCount || 1) + 1

        // Track all notification IDs in the group
        if (!existing.groupedIds) {
          existing.groupedIds = [existing.id]
        }
        existing.groupedIds.push(notification.id)

        // Keep the most recent createdAt
        if (notification.createdAt > existing.createdAt) {
          existing.createdAt = notification.createdAt
        }

        // If any notification in the group is unread, mark the group as unread
        if (!notification.isRead) {
          existing.isRead = false
        }

        continue
      }
    }

    // First notification with this groupKey, not groupable, or no groupKey.
    // Mastodon specifies ungrouped entries use 'ungrouped-{id}' as the group_key
    // so clients can address them individually via the single-group endpoints.
    const ungroupedKey = canGroup
      ? notification.groupKey!
      : `ungrouped-${notification.id}`
    groups.set(ungroupedKey, {
      ...notification,
      groupKey: ungroupedKey,
      groupedActors: undefined,
      groupedCount: 1,
      groupedIds: undefined
    })
  }

  // Convert to array and sort by most recent
  return Array.from(groups.values()).sort((a, b) => b.createdAt - a.createdAt)
}
