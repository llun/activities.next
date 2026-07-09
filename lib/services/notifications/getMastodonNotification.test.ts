import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { groupNotifications } from '@/lib/services/notifications/groupNotifications'
import { NotificationType } from '@/lib/types/database/operations'

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
    it.each([
      {
        description: 'maps like notification to favourite',
        type: NotificationType.enum.like,
        statusId,
        expected: 'favourite'
      },
      {
        description: 'maps reply notification to mention',
        type: NotificationType.enum.reply,
        statusId,
        expected: 'mention'
      },
      {
        description: 'maps reblog notification to reblog',
        type: NotificationType.enum.reblog,
        statusId,
        expected: 'reblog'
      },
      {
        description: 'keeps follow type as follow',
        type: NotificationType.enum.follow,
        statusId: undefined,
        expected: 'follow'
      },
      {
        description: 'keeps follow_request type as follow_request',
        type: NotificationType.enum.follow_request,
        statusId: undefined,
        expected: 'follow_request'
      },
      {
        description: 'keeps mention type as mention',
        type: NotificationType.enum.mention,
        statusId,
        expected: 'mention'
      }
    ])(
      '$description',
      async ({ type, statusId: notificationStatusId, expected }) => {
        const notification = await database.createNotification({
          actorId: actor1Id,
          type,
          sourceActorId: actor2Id,
          ...(notificationStatusId ? { statusId: notificationStatusId } : null)
        })

        const mastodonNotification = await getMastodonNotification(
          database,
          notification
        )

        expect(mastodonNotification).not.toBeNull()
        expect(mastodonNotification?.type).toBe(expected)
      }
    )
  })

  describe('group key', () => {
    it('emits the stored groupKey as group_key', async () => {
      const mastodonNotification = await getMastodonNotification(database, {
        id: 'gk-1',
        actorId: actor1Id,
        type: NotificationType.enum.like,
        sourceActorId: actor2Id,
        isRead: false,
        filtered: false,
        groupKey: `like:${statusId}`,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      expect(mastodonNotification?.group_key).toBe(`like:${statusId}`)
    })

    it('falls back to ungrouped-<id> when no groupKey is stored', async () => {
      const mastodonNotification = await getMastodonNotification(database, {
        id: 'gk-2',
        actorId: actor1Id,
        type: NotificationType.enum.follow,
        sourceActorId: actor2Id,
        isRead: false,
        filtered: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      expect(mastodonNotification?.group_key).toBe('ungrouped-gk-2')
    })

    it('reports ungrouped-<id> for a non-groupable type with a stored internal groupKey', async () => {
      // Mentions/replies/collections carry an internal stored groupKey (e.g.
      // `mention:<statusId>`) that is not a Mastodon group_key. A raw row of a
      // non-groupable type must report `ungrouped-<id>` — the same value the v2
      // grouped API emits — rather than leaking the internal key.
      const mastodonNotification = await getMastodonNotification(database, {
        id: 'gk-3',
        actorId: actor1Id,
        type: NotificationType.enum.mention,
        sourceActorId: actor2Id,
        statusId,
        isRead: false,
        filtered: false,
        groupKey: `mention:${statusId}`,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      expect(mastodonNotification?.group_key).toBe('ungrouped-gk-3')
    })

    it('keeps the computed group_key for already-grouped input', async () => {
      // includeGrouping means the grouping step already computed the key
      // (honoring the requested grouped_types), so it is trusted as-is rather
      // than re-gated on the default-groupable set.
      const mastodonNotification = await getMastodonNotification(
        database,
        {
          id: 'gk-4',
          actorId: actor1Id,
          type: NotificationType.enum.mention,
          sourceActorId: actor2Id,
          statusId,
          isRead: false,
          filtered: false,
          groupKey: `mention:${statusId}`,
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        { includeGrouping: true }
      )
      expect(mastodonNotification?.group_key).toBe(`mention:${statusId}`)
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
