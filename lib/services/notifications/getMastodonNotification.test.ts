import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { NotificationType } from '@/lib/database/types/notification'
import { groupNotifications } from '@/lib/services/notifications/groupNotifications'

import { getMastodonNotification } from './getMastodonNotification'

describe('getMastodonNotification', () => {
  const database = getTestSQLDatabase()

  const actor1Id = 'https://example.com/users/actor1'
  const actor2Id = 'https://example.com/users/actor2'
  const statusId = 'https://example.com/statuses/status1'

  beforeAll(async () => {
    await database.migrate()

    // Create test actors
    await database.createAccount({
      id: actor1Id,
      email: 'actor1@example.com',
      username: 'actor1',
      domain: 'example.com',
      privateKey: '',
      publicKey: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    await database.createAccount({
      id: actor2Id,
      email: 'actor2@example.com',
      username: 'actor2',
      domain: 'example.com',
      privateKey: '',
      publicKey: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('type mapping', () => {
    it('should map like notification to favourite', async () => {
      const notification = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.like,
        sourceActorId: actor2Id,
        statusId
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.type).toBe('favourite')
    })

    it('should map reply notification to mention', async () => {
      const notification = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.reply,
        sourceActorId: actor2Id,
        statusId
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.type).toBe('mention')
    })

    it('should map reblog notification to reblog', async () => {
      const notification = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.reblog,
        sourceActorId: actor2Id,
        statusId
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.type).toBe('reblog')
    })

    it('should keep follow type as follow', async () => {
      const notification = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.follow,
        sourceActorId: actor2Id
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.type).toBe('follow')
    })

    it('should keep follow_request type as follow_request', async () => {
      const notification = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.follow_request,
        sourceActorId: actor2Id
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.type).toBe('follow_request')
    })

    it('should keep mention type as mention', async () => {
      const notification = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.mention,
        sourceActorId: actor2Id,
        statusId
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.type).toBe('mention')
    })
  })

  describe('account serialization', () => {
    it('should include account in notification', async () => {
      const notification = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.follow,
        sourceActorId: actor2Id
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.account).toBeDefined()
      expect(mastodonNotification?.account.id).toBe('example.com:users:actor2')
      expect(mastodonNotification?.account.username).toBe('actor2')
    })

    it('should return null when account is not found', async () => {
      const notification = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.follow,
        sourceActorId: 'https://nonexistent.com/users/fake'
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification
      )

      expect(mastodonNotification).toBeNull()
    })
  })

  describe('status handling', () => {
    it('should exclude status when statusId is not present', async () => {
      const notification = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.follow,
        sourceActorId: actor2Id
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.status).toBeUndefined()
    })

    it('should handle statusId that does not exist', async () => {
      const notification = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.like,
        sourceActorId: actor2Id,
        statusId: 'https://example.com/statuses/nonexistent'
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.status).toBeUndefined()
    })
  })

  describe('grouping support', () => {
    it('should not include grouping fields when includeGrouping is false', async () => {
      const notification1 = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.like,
        sourceActorId: actor2Id,
        statusId,
        groupKey: 'like:test'
      })

      const notification2 = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.like,
        sourceActorId: actor1Id,
        statusId,
        groupKey: 'like:test'
      })

      const grouped = groupNotifications([notification1, notification2])

      const mastodonNotification = await getMastodonNotification(
        database,
        grouped[0],
        { includeGrouping: false }
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.grouped_count).toBeUndefined()
      expect(mastodonNotification?.grouped_accounts).toBeUndefined()
    })

    it('should include grouped_count when includeGrouping is true', async () => {
      const notification1 = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.like,
        sourceActorId: actor2Id,
        statusId,
        groupKey: 'like:test2'
      })

      const notification2 = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.like,
        sourceActorId: actor1Id,
        statusId,
        groupKey: 'like:test2'
      })

      const grouped = groupNotifications([notification1, notification2])

      const mastodonNotification = await getMastodonNotification(
        database,
        grouped[0],
        { includeGrouping: true }
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.grouped_count).toBe(2)
    })

    it('should include grouped_accounts when includeGrouping is true', async () => {
      const notification1 = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.like,
        sourceActorId: actor2Id,
        statusId,
        groupKey: 'like:test3'
      })

      const notification2 = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.like,
        sourceActorId: actor1Id,
        statusId,
        groupKey: 'like:test3'
      })

      const grouped = groupNotifications([notification1, notification2])

      const mastodonNotification = await getMastodonNotification(
        database,
        grouped[0],
        { includeGrouping: true }
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.grouped_accounts).toBeDefined()
      expect(mastodonNotification?.grouped_accounts?.length).toBeGreaterThan(0)
    })
  })

  describe('date formatting', () => {
    it('should format created_at as ISO 8601', async () => {
      const notification = await database.createNotification({
        actorId: actor1Id,
        type: NotificationType.enum.follow,
        sourceActorId: actor2Id
      })

      const mastodonNotification = await getMastodonNotification(
        database,
        notification
      )

      expect(mastodonNotification).not.toBeNull()
      expect(mastodonNotification?.created_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      )
    })
  })
})
