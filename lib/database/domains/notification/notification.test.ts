import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  type CreateNotificationParams,
  type GetNotificationsCountParams,
  type GetNotificationsParams,
  NotificationType
} from '@/lib/types/database/operations'
import { getPublicIdTimestamp, isPublicId } from '@/lib/utils/publicId'

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

      it('mints a UUIDv7 id whose timestamp is createdAt, so ids sort by creation time', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
          const created = []
          // Newest first in time, oldest last, so a passing sort is not an
          // accident of insertion order.
          for (const time of [
            Date.UTC(2026, 2, 1, 0, 0, 2),
            Date.UTC(2026, 2, 1, 0, 0, 1),
            Date.UTC(2026, 2, 1, 0, 0, 3)
          ]) {
            vi.setSystemTime(time)
            created.push(
              await database.createNotification({
                actorId: actor1Id,
                type: NotificationType.enum.follow,
                sourceActorId: actor2Id
              })
            )
          }

          for (const notification of created) {
            expect(isPublicId(notification.id)).toBe(true)
            expect(getPublicIdTimestamp(notification.id)).toBe(
              notification.createdAt
            )
          }
          const byId = [...created].sort((a, b) => (a.id < b.id ? -1 : 1))
          const byTime = [...created].sort((a, b) => a.createdAt - b.createdAt)
          expect(byId.map((n) => n.id)).toEqual(byTime.map((n) => n.id))
        } finally {
          vi.useRealTimers()
        }
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

    describe('getNotifications with sourceActorId', () => {
      it('filters by source actor in the database query', async () => {
        const recipient = 'https://example.com/users/source-filter-recipient'
        await database.createNotification({
          actorId: recipient,
          type: NotificationType.enum.like,
          sourceActorId: actor2Id,
          statusId
        })
        await database.createNotification({
          actorId: recipient,
          type: NotificationType.enum.like,
          sourceActorId: 'https://example.com/users/actor3',
          statusId
        })

        const rows = await database.getNotifications({
          actorId: recipient,
          limit: 10,
          sourceActorId: actor2Id
        })

        expect(rows).toHaveLength(1)
        expect(rows[0].sourceActorId).toBe(actor2Id)
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

      it('returns an empty page for an unresolvable min_id cursor', async () => {
        // A min_id whose row was dismissed/cleared (or a foreign id) must
        // terminate pagination, not drop the filter and return the oldest page.
        const result = await database.getNotifications({
          actorId: actor1Id,
          minNotificationId: 'does-not-exist',
          limit: 10
        })
        expect(result).toEqual([])
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

      it('returns only the newest rows up to the limit', async () => {
        for (let i = 0; i < 3; i++) {
          await database.createNotification({
            actorId: actor1Id,
            type: NotificationType.enum.like,
            sourceActorId: `https://example.com/users/liker-${i}`,
            statusId,
            groupKey: `like:${statusId}`
          })
        }

        const all = await database.getNotificationsForGroupKey({
          actorId: actor1Id,
          groupKey: `like:${statusId}`
        })
        expect(all).toHaveLength(5)

        const capped = await database.getNotificationsForGroupKey({
          actorId: actor1Id,
          groupKey: `like:${statusId}`,
          limit: 2
        })
        expect(capped.map((n) => n.id)).toEqual(
          all.slice(0, 2).map((n) => n.id)
        )
      })

      it('never returns more than the hard maximum even when asked for more', async () => {
        for (let i = 0; i < 1000; i++) {
          await database.createNotification({
            actorId: actor1Id,
            type: NotificationType.enum.like,
            sourceActorId: `https://example.com/users/bulk-${i}`,
            statusId,
            groupKey: `like:${statusId}`
          })
        }

        for (const limit of [undefined, 5000]) {
          const rows = await database.getNotificationsForGroupKey({
            actorId: actor1Id,
            groupKey: `like:${statusId}`,
            limit
          })
          expect(rows).toHaveLength(1000)
        }
      }, 30000)

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

    describe('queries only touch their own rows', () => {
      const at = (second: number) => Date.UTC(2031, 0, 1) + second * 1000
      const source = (n: number) =>
        `https://example.com/users/scoped-source${n}`
      const ids = (rows: { id: string }[]) => rows.map((row) => row.id)
      let recipient: string
      let other: string
      let sequence = 0

      beforeEach(() => {
        sequence += 1
        recipient = `https://example.com/users/scoped-recipient${sequence}`
        other = `https://example.com/users/scoped-other${sequence}`
        vi.useFakeTimers({ toFake: ['Date'] })
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      // A like from source 1 to the recipient, created `second` seconds into
      // the test's clock, unless the params say otherwise.
      const create = (
        second: number,
        params: Partial<CreateNotificationParams> = {}
      ) => {
        vi.setSystemTime(at(second))
        return database.createNotification({
          actorId: recipient,
          type: NotificationType.enum.like,
          sourceActorId: source(1),
          ...params
        })
      }

      const list = async (params: Partial<GetNotificationsParams> = {}) =>
        ids(
          await database.getNotifications({
            actorId: recipient,
            limit: 10,
            ...params
          })
        )

      const count = (params: Partial<GetNotificationsCountParams> = {}) =>
        database.getNotificationsCount({ actorId: recipient, ...params })

      const requestSources = async (
        params: Partial<Parameters<typeof database.getNotificationRequests>[0]>
      ) =>
        (
          await database.getNotificationRequests({
            actorId: recipient,
            limit: 10,
            ...params
          })
        ).map((request) => request.sourceActorId)

      // The recipient's requests: source 1 (two rows, the last at 2s), sources 2
      // and 3 (last at 3s, a tie) and source 4 (1s). Around them: another
      // recipient's newer filtered rows, one from source 1 and one from a source
      // only they have, and the recipient's own visible rows.
      const seedRequests = async () => {
        await create(1, { sourceActorId: source(1), filtered: true })
        await create(1, { sourceActorId: source(4), filtered: true })
        const lastOfSource1 = await create(2, {
          sourceActorId: source(1),
          filtered: true
        })
        await create(3, { sourceActorId: source(2), filtered: true })
        await create(3, { sourceActorId: source(3), filtered: true })
        await create(4, {
          actorId: other,
          sourceActorId: source(1),
          filtered: true
        })
        await create(4, {
          actorId: other,
          sourceActorId: source(5),
          filtered: true
        })
        const visible = await create(5, { sourceActorId: source(1) })
        await create(5, { sourceActorId: source(6) })
        return { lastOfSource1, visible }
      }

      it('reads rows back with null for unset ids and undefined for the rest', async () => {
        const follow = await create(1, { type: NotificationType.enum.follow })
        const reaction = await create(2, {
          type: NotificationType.enum.emoji_reaction,
          statusId,
          groupKey: 'emoji:1',
          reactionName: ':blob:'
        })

        expect(follow.statusId).toBeUndefined()
        const [reactionRow, followRow] = await database.getNotifications({
          actorId: recipient,
          limit: 10
        })
        expect(reactionRow).toMatchObject({
          id: reaction.id,
          statusId,
          groupKey: 'emoji:1',
          reactionName: ':blob:'
        })
        // The stored null comes back as it always has, not as undefined.
        expect(followRow).toEqual({
          id: follow.id,
          actorId: recipient,
          type: 'follow',
          sourceActorId: source(1),
          statusId: null,
          followId: null,
          groupKey: null,
          isRead: false,
          filtered: false,
          createdAt: at(1),
          updatedAt: at(1)
        })
        expect(followRow.reactionName).toBeUndefined()
        expect(followRow.readAt).toBeUndefined()
      })

      it("does not resolve another recipient's notification as a cursor", async () => {
        const older = await create(1)
        const foreign = await create(2, { actorId: other })
        const newer = await create(3)

        // The foreign id resolves to nothing, as a deleted one does: max_id
        // keeps every row and a lower bound ends the pagination.
        expect(await list({ maxNotificationId: foreign.id })).toEqual([
          newer.id,
          older.id
        ])
        expect(await list({ minNotificationId: foreign.id })).toEqual([])
        expect(await list({ sinceNotificationId: foreign.id })).toEqual([])
      })

      it('filters by type, read state and filtered flag, in lists and counts', async () => {
        const like = await create(1)
        const mention = await create(2, { type: NotificationType.enum.mention })
        const reblog = await create(3, { type: NotificationType.enum.reblog })
        await create(4, { filtered: true })
        await create(5, { actorId: other, type: NotificationType.enum.mention })
        await database.markNotificationsRead({ notificationIds: [like.id] })

        expect(await list()).toEqual([reblog.id, mention.id, like.id])
        expect(await list({ types: ['like', 'mention'] })).toEqual([
          mention.id,
          like.id
        ])
        expect(await list({ onlyUnread: true })).toEqual([
          reblog.id,
          mention.id
        ])
        expect(await count()).toBe(3)
        expect(await count({ includeFiltered: true })).toBe(4)
        expect(await count({ filteredOnly: true })).toBe(1)
        expect(await count({ types: ['like'] })).toBe(1)
        expect(await count({ types: ['mention', 'reblog'] })).toBe(2)
        expect(await count({ onlyUnread: true })).toBe(2)
      })

      it('marks only the given notifications read', async () => {
        const read = await create(1)
        const unread = await create(2)

        vi.setSystemTime(at(10))
        await database.markNotificationsRead({ notificationIds: [read.id] })

        const rows = await database.getNotifications({
          actorId: recipient,
          limit: 10
        })
        expect(rows.map((row) => [row.id, row.isRead, row.readAt])).toEqual([
          [unread.id, false, undefined],
          [read.id, true, at(10)]
        ])
      })

      it("lists requests newest first from the recipient's filtered rows, with cursors", async () => {
        const { lastOfSource1 } = await seedRequests()

        const requests = await database.getNotificationRequests({
          actorId: recipient,
          limit: 10
        })
        expect(requests.map((request) => request.sourceActorId)).toEqual(
          [2, 3, 1, 4].map(source)
        )
        expect(requests.map((request) => request.notificationsCount)).toEqual([
          1, 1, 2, 1
        ])
        expect(requests[2]).toMatchObject({
          createdAt: at(1),
          updatedAt: at(2)
        })
        expect(requests[2].lastNotification.id).toBe(lastOfSource1.id)

        expect(await requestSources({ limit: 2, offset: 1 })).toEqual(
          [3, 1].map(source)
        )
        // A group at the cursor's time is older when its source id sorts after
        // the cursor's, and newer when it sorts before.
        const maxCursor = (n: number) => ({
          updatedAt: at(3),
          sourceActorId: source(n)
        })
        expect(await requestSources({ maxCursor: maxCursor(2) })).toEqual(
          [3, 1, 4].map(source)
        )
        expect(await requestSources({ maxCursor: maxCursor(3) })).toEqual(
          [1, 4].map(source)
        )
        // A newer group stays off a max_id page, whatever its source id.
        expect(
          await requestSources({
            maxCursor: { updatedAt: at(2), sourceActorId: source(1) }
          })
        ).toEqual([source(4)])
        expect(
          await requestSources({
            sinceCursor: { updatedAt: at(2), sourceActorId: source(1) }
          })
        ).toEqual([2, 3].map(source))
        expect(await requestSources({ sinceCursor: maxCursor(3) })).toEqual([
          source(2)
        ])
      })

      it("builds a single request from the recipient's filtered rows of that source", async () => {
        const { lastOfSource1 } = await seedRequests()
        const get = (n: number) =>
          database.getNotificationRequest({
            actorId: recipient,
            sourceActorId: source(n)
          })

        const first = await get(1)
        expect(first).toMatchObject({
          sourceActorId: source(1),
          notificationsCount: 2,
          createdAt: at(1),
          updatedAt: at(2)
        })
        expect(first?.lastNotification.id).toBe(lastOfSource1.id)
        expect(await get(2)).toMatchObject({
          notificationsCount: 1,
          createdAt: at(3),
          updatedAt: at(3)
        })
        // Source 5 only requests from the other recipient, source 6 is visible.
        expect(await get(5)).toBeNull()
        expect(await get(6)).toBeNull()
      })

      it("counts the recipient's requesting sources, at most 100", async () => {
        await seedRequests()
        const countRequests = () =>
          database.getNotificationRequestsCount({ actorId: recipient })
        expect(await countRequests()).toBe(4)

        await Promise.all(
          Array.from({ length: 100 }, (_, i) =>
            create(6, { sourceActorId: source(100 + i), filtered: true })
          )
        )
        expect(await countRequests()).toBe(100)
      })

      it("accepts only the recipient's filtered rows of the given sources", async () => {
        const { visible } = await seedRequests()

        vi.setSystemTime(at(100))
        await database.acceptNotificationRequests({
          actorId: recipient,
          sourceActorIds: [source(1)]
        })

        const rows = await database.getNotifications({
          actorId: recipient,
          limit: 50,
          includeFiltered: true
        })
        expect(
          rows
            .filter((row) => row.filtered)
            .map((row) => row.sourceActorId)
            .sort()
        ).toEqual([2, 3, 4].map(source))
        // The two accepted rows are touched, the already visible one is not.
        expect(rows.filter((row) => row.updatedAt === at(100))).toHaveLength(2)
        expect(rows.find((row) => row.id === visible.id)?.updatedAt).toBe(at(5))
        const others = await database.getNotifications({
          actorId: other,
          limit: 50,
          includeFiltered: true
        })
        expect(others.map((row) => row.filtered)).toEqual([true, true])
      })

      it("dismisses only the recipient's filtered rows of the given sources", async () => {
        await seedRequests()

        await database.dismissNotificationRequests({
          actorId: recipient,
          sourceActorIds: [source(1)]
        })

        const rows = await database.getNotifications({
          actorId: recipient,
          limit: 50,
          includeFiltered: true
        })
        expect(
          rows.map((row) => `${row.sourceActorId}:${row.filtered}`).sort()
        ).toEqual([
          `${source(1)}:false`,
          `${source(2)}:true`,
          `${source(3)}:true`,
          `${source(4)}:true`,
          `${source(6)}:false`
        ])
        expect(
          await database.getNotifications({
            actorId: other,
            limit: 50,
            includeFiltered: true
          })
        ).toHaveLength(2)
      })

      it.each([
        'acceptNotificationRequests',
        'dismissNotificationRequests'
      ] as const)(
        '%s resolves sources beyond the first list of ids',
        async (method) => {
          await create(1, { sourceActorId: source(1), filtered: true })
          await create(1, { sourceActorId: source(2), filtered: true })
          const filler = Array.from(
            { length: 1500 },
            (_, i) => `https://example.com/users/nobody${i}`
          )

          await database[method]({
            actorId: recipient,
            sourceActorIds: [source(1), ...filler, source(2)]
          })

          expect(await requestSources({})).toEqual([])
        }
      )

      it('looks up and dismisses a group for the recipient only', async () => {
        const first = await create(1, { groupKey: 'like:x' })
        const second = await create(2, { groupKey: 'like:x' })
        const unrelated = await create(3, { groupKey: 'like:y' })
        const ungrouped = await create(4)
        await create(5, { actorId: other, groupKey: 'like:x' })
        const lookup = async (actorId: string, groupKey: string) =>
          ids(await database.getNotificationsForGroupKey({ actorId, groupKey }))

        expect(await lookup(recipient, 'like:x')).toEqual([second.id, first.id])
        expect(await lookup(recipient, ungrouped.id)).toEqual([ungrouped.id])

        await database.dismissNotificationGroup({
          actorId: recipient,
          groupKey: 'like:x'
        })
        expect(await list()).toEqual([ungrouped.id, unrelated.id])
        await database.dismissNotificationGroup({
          actorId: recipient,
          groupKey: ungrouped.id
        })
        expect(await list()).toEqual([unrelated.id])
        expect(await lookup(other, 'like:x')).toHaveLength(1)
      })

      it('deletes only the notification asked for', async () => {
        const keep = await create(1)
        const drop = await create(2)

        await database.deleteNotification(drop.id)

        expect(await list()).toEqual([keep.id])
      })
    })
  })
})
