import { Notification } from '@/lib/database/types/notification'

export interface GroupedNotification extends Notification {
  groupedActors?: string[]
  groupedCount?: number
  groupedIds?: string[]
}

export const groupNotifications = (
  notifications: Notification[],
  enableGrouping: boolean = true
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
    // Group by groupKey (e.g., "like:statusId" or "reply:statusId")
    if (notification.groupKey) {
      const existing = groups.get(notification.groupKey)
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

    // First notification with this groupKey or no groupKey
    groups.set(notification.groupKey || notification.id, {
      ...notification,
      groupedActors: undefined,
      groupedCount: 1,
      groupedIds: undefined
    })
  }

  // Convert to array and sort by most recent
  return Array.from(groups.values()).sort((a, b) => b.createdAt - a.createdAt)
}
