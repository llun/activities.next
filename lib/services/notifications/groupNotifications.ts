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
  // If grouping is disabled, return notifications as-is with minimal GroupedNotification fields
  if (!enableGrouping) {
    return notifications.map((notification) => ({
      ...notification,
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
    // When not grouping a notification that has a shared groupKey, use the
    // notification's own id as the key so each individual entry gets a unique
    // group_key in the Mastodon response rather than sharing the original key.
    const mapKey = canGroup ? notification.groupKey! : notification.id
    groups.set(mapKey, {
      ...notification,
      // Override groupKey so the Mastodon group_key is unique per notification.
      groupKey: canGroup ? notification.groupKey : notification.id,
      groupedActors: undefined,
      groupedCount: 1,
      groupedIds: undefined
    })
  }

  // Convert to array and sort by most recent
  return Array.from(groups.values()).sort((a, b) => b.createdAt - a.createdAt)
}
