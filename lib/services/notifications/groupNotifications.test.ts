import { NotificationType } from '@/lib/database/types/notification'

import { GroupedNotification, groupNotifications } from './groupNotifications'

describe('#groupNotifications', () => {
  const baseNotification = {
    actorId: 'https://example.com/users/user1',
    type: NotificationType.enum.like,
    isRead: false,
    createdAt: Date.now()
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
    it('groups notifications with the same groupKey', () => {
      const notifications = [
        createNotification('n1', 'actor1', {
          groupKey: 'like:status1',
          createdAt: 1000
        }),
        createNotification('n2', 'actor2', {
          groupKey: 'like:status1',
          createdAt: 2000
        }),
        createNotification('n3', 'actor3', {
          groupKey: 'like:status1',
          createdAt: 3000
        })
      ]

      const result = groupNotifications(notifications)

      expect(result).toHaveLength(1)
      expect(result[0].groupedCount).toBe(3)
      expect(result[0].groupedActors).toEqual(['actor1', 'actor2', 'actor3'])
      expect(result[0].groupedIds).toEqual(['n1', 'n2', 'n3'])
    })

    it('keeps notifications without groupKey separate', () => {
      const notifications = [
        createNotification('n1', 'actor1', { groupKey: undefined }),
        createNotification('n2', 'actor2', { groupKey: undefined })
      ]

      const result = groupNotifications(notifications)

      expect(result).toHaveLength(2)
    })

    it('uses the most recent createdAt for grouped notifications', () => {
      const notifications = [
        createNotification('n1', 'actor1', {
          groupKey: 'like:status1',
          createdAt: 1000
        }),
        createNotification('n2', 'actor2', {
          groupKey: 'like:status1',
          createdAt: 5000
        }),
        createNotification('n3', 'actor3', {
          groupKey: 'like:status1',
          createdAt: 3000
        })
      ]

      const result = groupNotifications(notifications)

      expect(result[0].createdAt).toBe(5000)
    })

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

    it('sorts results by most recent first', () => {
      const notifications = [
        createNotification('n1', 'actor1', {
          groupKey: 'like:status1',
          createdAt: 1000
        }),
        createNotification('n2', 'actor2', {
          groupKey: 'like:status2',
          createdAt: 3000
        }),
        createNotification('n3', 'actor3', {
          groupKey: 'like:status3',
          createdAt: 2000
        })
      ]

      const result = groupNotifications(notifications)

      expect(result).toHaveLength(3)
      expect(result[0].id).toBe('n2')
      expect(result[1].id).toBe('n3')
      expect(result[2].id).toBe('n1')
    })

    it('handles mixed grouped and ungrouped notifications', () => {
      const notifications = [
        createNotification('n1', 'actor1', {
          groupKey: 'like:status1',
          createdAt: 1000
        }),
        createNotification('n2', 'actor2', {
          groupKey: undefined,
          createdAt: 2000
        }),
        createNotification('n3', 'actor3', {
          groupKey: 'like:status1',
          createdAt: 3000
        })
      ]

      const result = groupNotifications(notifications)

      expect(result).toHaveLength(2)
      const groupedNotification = result.find(
        (n) => n.groupedCount && n.groupedCount > 1
      ) as GroupedNotification
      expect(groupedNotification.groupedCount).toBe(2)
    })

    it('handles empty notifications array', () => {
      const result = groupNotifications([])
      expect(result).toHaveLength(0)
    })
  })
})
