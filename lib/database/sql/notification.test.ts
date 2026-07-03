import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { NotificationType } from '@/lib/types/database/operations'

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

      it('distinguishes min_id (adjacent page) from since_id (newest slice)', async () => {
        // beforeEach seeds 3; add 2 more so the window above the cursor exceeds
        // the page limit and the two cursor kinds diverge.
        await new Promise((resolve) => setTimeout(resolve, 10))
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.like,
          sourceActorId: actor2Id,
          statusId,
          groupKey: 'like:2'
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.reblog,
          sourceActorId: actor2Id,
          statusId,
          groupKey: 'reblog:2'
        })

        const all = await database.getNotifications({
          actorId: actor1Id,
          limit: 10
        })
        expect(all).toHaveLength(5)
        const oldestId = all[4].id

        const withSinceId = await database.getNotifications({
          actorId: actor1Id,
          sinceNotificationId: oldestId,
          limit: 2
        })
        const withMinId = await database.getNotifications({
          actorId: actor1Id,
          minNotificationId: oldestId,
          limit: 2
        })

        // since_id returns the two NEWEST notifications above the cursor.
        expect(withSinceId.map((n) => n.id)).toEqual([all[0].id, all[1].id])
        // min_id returns the two OLDEST above the cursor (the adjacent page),
        // still newest-first — NOT the same slice as since_id.
        expect(withMinId.map((n) => n.id)).toEqual([all[2].id, all[3].id])
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

      it('combines cursor pagination with excludeTypes filtering', async () => {
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

    describe('filtered notifications', () => {
      beforeEach(async () => {
        const existing = await database.getNotifications({
          actorId: actor1Id,
          limit: 100,
          includeFiltered: true
        })
        for (const notif of existing) {
          await database.deleteNotification(notif.id)
        }

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
          statusId,
          filtered: true
        })
      })

      it('hides filtered notifications by default', async () => {
        const notifications = await database.getNotifications({
          actorId: actor1Id,
          limit: 10
        })

        expect(notifications).toHaveLength(1)
        expect(notifications[0].type).toBe('like')
        expect(notifications[0].filtered).toBe(false)
      })

      it('includes filtered notifications when includeFiltered is true', async () => {
        const notifications = await database.getNotifications({
          actorId: actor1Id,
          limit: 10,
          includeFiltered: true
        })

        expect(notifications).toHaveLength(2)
        expect(notifications.some((n) => n.filtered === true)).toBe(true)
      })

      it('excludes filtered notifications from the default count', async () => {
        const count = await database.getNotificationsCount({
          actorId: actor1Id
        })
        expect(count).toBe(1)

        const allCount = await database.getNotificationsCount({
          actorId: actor1Id,
          includeFiltered: true
        })
        expect(allCount).toBe(2)
      })
    })

    describe('getNotificationsCount', () => {
      beforeEach(async () => {
        const existing = await database.getNotifications({
          actorId: actor1Id,
          limit: 100,
          includeFiltered: true
        })
        for (const notif of existing) {
          await database.deleteNotification(notif.id)
        }

        for (let i = 0; i < 5; i++) {
          await database.createNotification({
            actorId: actor1Id,
            type: NotificationType.enum.like,
            sourceActorId: actor2Id,
            statusId
          })
        }
      })

      it('caps the count at the provided limit', async () => {
        const capped = await database.getNotificationsCount({
          actorId: actor1Id,
          limit: 3
        })
        expect(capped).toBe(3)

        const uncapped = await database.getNotificationsCount({
          actorId: actor1Id
        })
        expect(uncapped).toBe(5)
      })

      it('filters the count by excludeTypes', async () => {
        const count = await database.getNotificationsCount({
          actorId: actor1Id,
          excludeTypes: [NotificationType.enum.like]
        })
        expect(count).toBe(0)
      })
    })

    describe('notification requests', () => {
      const actor3Id = 'https://example.com/users/actor3'

      beforeEach(async () => {
        const existing = await database.getNotifications({
          actorId: actor1Id,
          limit: 100,
          includeFiltered: true
        })
        for (const notif of existing) {
          await database.deleteNotification(notif.id)
        }

        // Two filtered notifications from actor2, one from actor3, plus one
        // accepted (unfiltered) notification that must never appear as a request.
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.mention,
          sourceActorId: actor2Id,
          statusId,
          filtered: true
        })
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.like,
          sourceActorId: actor2Id,
          statusId,
          filtered: true
        })
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.follow,
          sourceActorId: actor3Id,
          filtered: true
        })
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.like,
          sourceActorId: actor2Id,
          statusId
        })
      })

      it('groups filtered notifications by source actor', async () => {
        const requests = await database.getNotificationRequests({
          actorId: actor1Id,
          limit: 40
        })

        expect(requests).toHaveLength(2)
        const actor2Request = requests.find((r) => r.sourceActorId === actor2Id)
        expect(actor2Request?.notificationsCount).toBe(2)
        expect(actor2Request?.lastNotification.filtered).toBe(true)
      })

      it('counts distinct source actors with filtered notifications', async () => {
        const count = await database.getNotificationRequestsCount({
          actorId: actor1Id
        })
        expect(count).toBe(2)
      })

      it('fetches a single request by source actor', async () => {
        const request = await database.getNotificationRequest({
          actorId: actor1Id,
          sourceActorId: actor2Id
        })
        expect(request?.notificationsCount).toBe(2)

        const missing = await database.getNotificationRequest({
          actorId: actor1Id,
          sourceActorId: 'https://example.com/users/nobody'
        })
        expect(missing).toBeNull()
      })

      it('accept clears the filtered flag and surfaces notifications', async () => {
        await database.acceptNotificationRequests({
          actorId: actor1Id,
          sourceActorIds: [actor2Id]
        })

        const remaining = await database.getNotificationRequests({
          actorId: actor1Id,
          limit: 40
        })
        expect(remaining.map((r) => r.sourceActorId)).toEqual([actor3Id])

        // The two accepted notifications now show in the default (unfiltered) list.
        const visible = await database.getNotifications({
          actorId: actor1Id,
          limit: 40
        })
        const fromActor2 = visible.filter((n) => n.sourceActorId === actor2Id)
        expect(fromActor2).toHaveLength(3)
        expect(fromActor2.every((n) => n.filtered === false)).toBe(true)
      })

      it('dismiss deletes the filtered notifications', async () => {
        await database.dismissNotificationRequests({
          actorId: actor1Id,
          sourceActorIds: [actor2Id]
        })

        const all = await database.getNotifications({
          actorId: actor1Id,
          limit: 40,
          includeFiltered: true
        })
        const filteredFromActor2 = all.filter(
          (n) => n.sourceActorId === actor2Id && n.filtered
        )
        expect(filteredFromActor2).toHaveLength(0)
        // The previously-accepted actor2 notification is untouched.
        expect(all.filter((n) => n.sourceActorId === actor2Id)).toHaveLength(1)
      })
    })

    describe('grouped notification lookup', () => {
      beforeEach(async () => {
        const existing = await database.getNotifications({
          actorId: actor1Id,
          limit: 100,
          includeFiltered: true
        })
        for (const notif of existing) {
          await database.deleteNotification(notif.id)
        }

        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.like,
          sourceActorId: actor2Id,
          statusId,
          groupKey: `like:${statusId}`
        })
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.like,
          sourceActorId: 'https://example.com/users/actor3',
          statusId,
          groupKey: `like:${statusId}`
        })
      })

      it('resolves all notifications for a shared group key', async () => {
        const notifications = await database.getNotificationsForGroupKey({
          actorId: actor1Id,
          groupKey: `like:${statusId}`
        })
        expect(notifications).toHaveLength(2)
      })

      it('resolves an ungrouped notification by its id', async () => {
        const created = await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.follow,
          sourceActorId: actor2Id
        })

        const notifications = await database.getNotificationsForGroupKey({
          actorId: actor1Id,
          groupKey: created.id
        })
        expect(notifications).toHaveLength(1)
        expect(notifications[0].id).toBe(created.id)
      })

      it('dismisses every notification in a group', async () => {
        await database.dismissNotificationGroup({
          actorId: actor1Id,
          groupKey: `like:${statusId}`
        })

        const remaining = await database.getNotificationsForGroupKey({
          actorId: actor1Id,
          groupKey: `like:${statusId}`
        })
        expect(remaining).toHaveLength(0)
      })

      it('resolves persisted day-bucketed follow rows under their bucket key', async () => {
        // Two follows in the same day bucket share the persisted key.
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.follow,
          sourceActorId: actor2Id,
          groupKey: 'follow:20000'
        })
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.follow,
          sourceActorId: 'https://example.com/users/actor3',
          groupKey: 'follow:20000'
        })
        // A follow in a different day bucket is a separate group.
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.follow,
          sourceActorId: 'https://example.com/users/actor4',
          groupKey: 'follow:20001'
        })

        const bucket = await database.getNotificationsForGroupKey({
          actorId: actor1Id,
          groupKey: 'follow:20000'
        })
        expect(bucket).toHaveLength(2)
      })

      it('resolves a legacy null-key follow row by its notification id', async () => {
        const legacy = await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.follow,
          sourceActorId: actor2Id
        })

        const byId = await database.getNotificationsForGroupKey({
          actorId: actor1Id,
          groupKey: legacy.id
        })
        expect(byId).toHaveLength(1)
        expect(byId[0].id).toBe(legacy.id)
      })

      it('does not dismiss filtered rows sharing the group key', async () => {
        // A pending policy-filtered like sharing the same group key.
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.like,
          sourceActorId: 'https://example.com/users/actor4',
          statusId,
          groupKey: `like:${statusId}`,
          filtered: true
        })

        await database.dismissNotificationGroup({
          actorId: actor1Id,
          groupKey: `like:${statusId}`
        })

        // Visible rows are gone, the filtered request row survives.
        const visible = await database.getNotificationsForGroupKey({
          actorId: actor1Id,
          groupKey: `like:${statusId}`,
          includeFiltered: false
        })
        expect(visible).toHaveLength(0)
        const withFiltered = await database.getNotificationsForGroupKey({
          actorId: actor1Id,
          groupKey: `like:${statusId}`,
          includeFiltered: true
        })
        expect(withFiltered).toHaveLength(1)
        expect(withFiltered[0].filtered).toBe(true)
      })

      it('dismisses every follow row in a day bucket', async () => {
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.follow,
          sourceActorId: actor2Id,
          groupKey: 'follow:20000'
        })
        await database.createNotification({
          actorId: actor1Id,
          type: NotificationType.enum.follow,
          sourceActorId: 'https://example.com/users/actor3',
          groupKey: 'follow:20000'
        })

        await database.dismissNotificationGroup({
          actorId: actor1Id,
          groupKey: 'follow:20000'
        })

        const remaining = await database.getNotificationsForGroupKey({
          actorId: actor1Id,
          groupKey: 'follow:20000'
        })
        expect(remaining).toHaveLength(0)
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
