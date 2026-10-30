import { NotificationType } from '@/lib/types/database/operations'

import { groupNotifications } from './groupNotifications'

describe('groupNotifications', () => {
  const baseNotification = {
    actorId: 'https://example.com/users/user1',
    type: NotificationType.enum.like,
    isRead: false,
    filtered: false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  const createNotification = (
    id: string,
    sourceActorId: string,
    options: Partial<typeof baseNotification & { groupKey?: string }> = {}
  ) => ({
    ...baseNotification,
    id,
    sourceActorId,
    ...options
  })

  describe('when grouping is disabled', () => {
    it('returns notifications as-is with minimal grouped fields', () => {
      const notifications = [
        createNotification('n1', 'actor1', { groupKey: 'like:status1' }),
        createNotification('n2', 'actor2', { groupKey: 'like:status1' })
      ]

      const result = groupNotifications(notifications, false)

      expect(result).toHaveLength(2)
      expect(result[0].groupedActors).toBeUndefined()
      expect(result[0].groupedCount).toBe(1)
      expect(result[1].groupedActors).toBeUndefined()
      expect(result[1].groupedCount).toBe(1)
    })
  })

  describe('when grouping is enabled', () => {
    it('marks group as unread if any notification is unread', () => {
      const notifications = [
        createNotification('n1', 'actor1', {
          groupKey: 'like:status1',
          isRead: true
        }),
        createNotification('n2', 'actor2', {
          groupKey: 'like:status1',
          isRead: false
        })
      ]

      const result = groupNotifications(notifications)

      expect(result[0].isRead).toBe(false)
    })

    it('keeps all read if all are read', () => {
      const notifications = [
        createNotification('n1', 'actor1', {
          groupKey: 'like:status1',
          isRead: true
        }),
        createNotification('n2', 'actor2', {
          groupKey: 'like:status1',
          isRead: true
        })
      ]

      const result = groupNotifications(notifications)

      expect(result[0].isRead).toBe(true)
    })

    it('handles empty notifications array', () => {
      const result = groupNotifications([])
      expect(result).toHaveLength(0)
    })
  })
})
