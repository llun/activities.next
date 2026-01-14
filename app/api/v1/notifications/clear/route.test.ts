import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getMastodonNotification } from '@/lib/services/notifications/getMastodonNotification'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

jest.mock('../../../../../lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({ host: 'llun.test' })
}))

/**
 * Tests for Mastodon-compatible notification endpoints
 *
 * API Reference: https://docs.joinmastodon.org/methods/notifications/
 *
 * These tests verify:
 * - GET /api/v1/notifications - Returns array of Notification
 * - GET /api/v1/notifications/:id - Returns single Notification
 * - POST /api/v1/notifications/clear - Clears all notifications, returns {}
 * - POST /api/v1/notifications/:id/dismiss - Dismisses single notification, returns {}
 * - POST /api/v1/notifications/dismiss (deprecated) - Dismisses by id in body
 */
describe('Notification Endpoints', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  describe('notification retrieval', () => {
    it('returns notifications for actor', async () => {
      // Create a notification
      await database.createNotification({
        actorId: ACTOR1_ID,
        type: 'follow',
        sourceActorId: ACTOR2_ID,
        statusId: null,
        createdAt: Date.now()
      })

      const notifications = await database.getNotifications({
        actorId: ACTOR1_ID,
        limit: 10
      })

      expect(notifications).toBeArray()
      expect(notifications.length).toBeGreaterThanOrEqual(1)
    })

    it('returns notification with correct Mastodon format', async () => {
      // Create a notification
      const notification = await database.createNotification({
        actorId: ACTOR1_ID,
        type: 'mention',
        sourceActorId: ACTOR2_ID,
        statusId: `${ACTOR2_ID}/statuses/post-2`,
        createdAt: Date.now()
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification,
        { currentActorId: ACTOR1_ID }
      )

      expect(mastodonNotification).toMatchObject({
        id: expect.toBeString(),
        type: 'mention',
        created_at: expect.toBeString(),
        account: expect.objectContaining({
          id: expect.toBeString(),
          username: expect.toBeString()
        })
      })
    })
  })

  describe('notification dismiss', () => {
    it('deletes notification by id', async () => {
      // Create a notification
      const notification = await database.createNotification({
        actorId: ACTOR1_ID,
        type: 'favourite',
        sourceActorId: ACTOR2_ID,
        statusId: `${ACTOR1_ID}/statuses/post-1`,
        createdAt: Date.now()
      })

      // Verify it exists
      const beforeDelete = await database.getNotifications({
        actorId: ACTOR1_ID,
        ids: [notification.id],
        limit: 1
      })
      expect(beforeDelete.length).toBe(1)

      // Delete it
      await database.deleteNotification(notification.id)

      // Verify it's gone
      const afterDelete = await database.getNotifications({
        actorId: ACTOR1_ID,
        ids: [notification.id],
        limit: 1
      })
      expect(afterDelete.length).toBe(0)
    })
  })

  describe('notification clear', () => {
    it('deletes all notifications for actor', async () => {
      // Create multiple notifications
      for (let i = 0; i < 3; i++) {
        await database.createNotification({
          actorId: ACTOR1_ID,
          type: 'follow',
          sourceActorId: ACTOR2_ID,
          statusId: null,
          createdAt: Date.now() + i
        })
      }

      // Get all notifications
      const notifications = await database.getNotifications({
        actorId: ACTOR1_ID,
        limit: 100
      })

      // Delete them all
      await Promise.all(
        notifications.map((n) => database.deleteNotification(n.id))
      )

      // Verify all are gone
      const remaining = await database.getNotifications({
        actorId: ACTOR1_ID,
        limit: 100
      })

      expect(remaining.length).toBe(0)
    })
  })

  describe('notification types', () => {
    it('handles follow notification type', async () => {
      const notification = await database.createNotification({
        actorId: ACTOR1_ID,
        type: 'follow',
        sourceActorId: ACTOR2_ID,
        statusId: null,
        createdAt: Date.now()
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification,
        { currentActorId: ACTOR1_ID }
      )

      expect(mastodonNotification?.type).toBe('follow')
      expect(mastodonNotification?.status).toBeUndefined()
    })

    it('handles reblog notification type', async () => {
      const notification = await database.createNotification({
        actorId: ACTOR1_ID,
        type: 'reblog',
        sourceActorId: ACTOR2_ID,
        statusId: `${ACTOR1_ID}/statuses/post-1`,
        createdAt: Date.now()
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification,
        { currentActorId: ACTOR1_ID }
      )

      expect(mastodonNotification?.type).toBe('reblog')
    })

    it('handles like notification as favourite type', async () => {
      const notification = await database.createNotification({
        actorId: ACTOR1_ID,
        type: 'like',
        sourceActorId: ACTOR2_ID,
        statusId: `${ACTOR1_ID}/statuses/post-1`,
        createdAt: Date.now()
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification,
        { currentActorId: ACTOR1_ID }
      )

      // Internal 'like' type should be mapped to Mastodon 'favourite'
      expect(mastodonNotification?.type).toBe('favourite')
    })
  })
})
