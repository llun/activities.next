import { databaseBeforeAll, getTestDatabaseTable } from '../testUtils'
import { NotificationType } from './notification'

describe('Notification Database', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    const actor1Id = 'https://example.com/users/actor1'
    const actor2Id = 'https://example.com/users/actor2'
    const statusId = 'https://example.com/statuses/status1'

    describe('createNotification', () => {
      it('should create a reblog notification', async () => {
        const notification = await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.reblog,
          sourceActorId: actor2Id,
          statusId,
          groupKey: `reblog:${statusId}`
        })

        expect(notification).toMatchObject({
          actorId: actor1Id,
          type: 'reblog',
          sourceActorId: actor2Id,
          statusId,
          groupKey: `reblog:${statusId}`,
          isRead: false
        })
        expect(notification.id).toBeString()
        expect(notification.createdAt).toBeNumber()
      })

      it('should create all notification types', async () => {
        const types: NotificationType[] = [
          'follow_request',
          'follow',
          'like',
          'mention',
          'reply',
          'reblog'
        ]

        for (const type of types) {
          const notification = await database.createNotification({
            actorId: actor1Id,
            type,
            sourceActorId: actor2Id,
            statusId:
              type !== 'follow' && type !== 'follow_request'
                ? statusId
                : undefined
          })

          expect(notification.type).toBe(type)
        }
      })
    })

    describe('getNotifications with cursor pagination', () => {
      beforeEach(async () => {
        // Clean up notifications
        const existingNotifications = await database.getNotifications({
          actorId: actor1Id,
          limit: 100
        })
        for (const notif of existingNotifications) {
          await database.deleteNotification(notif.id)
        }

        // Create test notifications with delays to ensure different createdAt times
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.like,
          sourceActorId: actor2Id,
          statusId,
          groupKey: 'like:1'
        })
        await new Promise((resolve) => setTimeout(resolve, 10))

        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.mention,
          sourceActorId: actor2Id,
          statusId
        })
        await new Promise((resolve) => setTimeout(resolve, 10))

        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.reblog,
          sourceActorId: actor2Id,
          statusId,
          groupKey: 'reblog:1'
        })
      })

      it('should return notifications with max_id cursor (older notifications)', async () => {
        const allNotifications = await database.getNotifications({
          actorId: actor1Id,
          limit: 10
        })

        expect(allNotifications).toHaveLength(3)

        // Get notifications older than the most recent one
        const olderNotifications = await database.getNotifications({
          actorId: actor1Id,
          maxNotificationId: allNotifications[0].id,
          limit: 10
        })

        expect(olderNotifications).toHaveLength(2)
        expect(olderNotifications[0].createdAt).toBeLessThan(
          allNotifications[0].createdAt
        )
      })

      it('should return notifications with min_id cursor (newer notifications)', async () => {
        const allNotifications = await database.getNotifications({
          actorId: actor1Id,
          limit: 10
        })

        expect(allNotifications).toHaveLength(3)

        // Get notifications newer than the oldest one
        const newerNotifications = await database.getNotifications({
          actorId: actor1Id,
          minNotificationId: allNotifications[2].id,
          limit: 10
        })

        expect(newerNotifications).toHaveLength(2)
        expect(newerNotifications[0].createdAt).toBeGreaterThan(
          allNotifications[2].createdAt
        )
      })

      it('should return notifications with since_id cursor (same as min_id)', async () => {
        const allNotifications = await database.getNotifications({
          actorId: actor1Id,
          limit: 10
        })

        const withMinId = await database.getNotifications({
          actorId: actor1Id,
          minNotificationId: allNotifications[2].id,
          limit: 10
        })

        const withSinceId = await database.getNotifications({
          actorId: actor1Id,
          sinceNotificationId: allNotifications[2].id,
          limit: 10
        })

        expect(withMinId).toHaveLength(withSinceId.length)
        expect(withMinId.map((n) => n.id)).toEqual(withSinceId.map((n) => n.id))
      })

      it('should handle non-existent cursor ID gracefully', async () => {
        const notifications = await database.getNotifications({
          actorId: actor1Id,
          maxNotificationId: 'non-existent-id',
          limit: 10
        })

        // Should return all notifications when cursor doesn't exist
        expect(notifications).toHaveLength(3)
      })

      it('should respect limit parameter with cursor pagination', async () => {
        const notifications = await database.getNotifications({
          actorId: actor1Id,
          limit: 1
        })

        expect(notifications).toHaveLength(1)

        const olderNotifications = await database.getNotifications({
          actorId: actor1Id,
          maxNotificationId: notifications[0].id,
          limit: 1
        })

        expect(olderNotifications).toHaveLength(1)
      })
    })

    describe('getNotifications with excludeTypes', () => {
      beforeEach(async () => {
        // Clean up notifications
        const existingNotifications = await database.getNotifications({
          actorId: actor1Id,
          limit: 100
        })
        for (const notif of existingNotifications) {
          await database.deleteNotification(notif.id)
        }

        // Create notifications of different types
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.like,
          sourceActorId: actor2Id,
          statusId
        })
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.mention,
          sourceActorId: actor2Id,
          statusId
        })
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.reblog,
          sourceActorId: actor2Id,
          statusId
        })
      })

      it('should exclude specified notification types', async () => {
        const notifications = await database.getNotifications({
          actorId: actor1Id,
          excludeTypes: [
            NotificationType.enum.like,
            NotificationType.enum.reblog
          ],
          limit: 10
        })

        expect(notifications).toHaveLength(1)
        expect(notifications[0].type).toBe('mention')
      })

      it('should work with cursor pagination and excludeTypes together', async () => {
        const allNotifications = await database.getNotifications({
          actorId: actor1Id,
          limit: 10
        })

        const filtered = await database.getNotifications({
          actorId: actor1Id,
          maxNotificationId: allNotifications[0].id,
          excludeTypes: [NotificationType.enum.like],
          limit: 10
        })

        expect(filtered.every((n) => n.type !== 'like')).toBe(true)
        // With composite cursor (createdAt, id), notifications can have same createdAt but lower id
        expect(
          filtered.every(
            (n) =>
              n.createdAt < allNotifications[0].createdAt ||
              (n.createdAt === allNotifications[0].createdAt &&
                n.id < allNotifications[0].id)
          )
        ).toBe(true)
      })
    })

    describe('getNotifications ordering', () => {
      it('should order notifications by createdAt desc', async () => {
        const notifications = await database.getNotifications({
          actorId: actor1Id,
          limit: 10
        })

        for (let i = 0; i < notifications.length - 1; i++) {
          expect(notifications[i].createdAt).toBeGreaterThanOrEqual(
            notifications[i + 1].createdAt
          )
        }
      })
    })

    describe('deleteNotification', () => {
      it('should delete a notification', async () => {
        const notification = await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.like,
          sourceActorId: actor2Id,
          statusId
        })

        await database.deleteNotification(notification.id)

        const notifications = await database.getNotifications({
          actorId: actor1Id,
          ids: [notification.id],
          limit: 1
        })

        expect(notifications).toHaveLength(0)
      })
    })
  })
})
