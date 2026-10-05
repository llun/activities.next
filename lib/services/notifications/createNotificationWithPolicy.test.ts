import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { NotificationType } from '@/lib/types/database/operations'

// The block/mute gate of the single notification-creation seam. Every path
// that raises a notification (remote reply/mention fan-out, follow and follow
// request, quote, collection) goes through here, so the gate must hold for
// every type, not only the like/reblog/reaction paths that check it upstream.
describe('createNotificationWithPolicy block and mute suppression', () => {
  let database: Database
  let recipientId: string
  let sourceId: string

  beforeEach(async () => {
    database = getTestSQLDatabase()
    await database.migrate()
    for (const username of ['recipient', 'source']) {
      await database.createAccount({
        email: `${username}@${TEST_DOMAIN}`,
        username,
        passwordHash: 'hash',
        domain: TEST_DOMAIN,
        privateKey: `privateKey-${username}`,
        publicKey: `publicKey-${username}`
      })
    }
    recipientId = `https://${TEST_DOMAIN}/users/recipient`
    sourceId = `https://${TEST_DOMAIN}/users/source`
  })

  afterEach(async () => {
    await database.destroy()
  })

  const notify = (
    type: NotificationType = NotificationType.enum.follow,
    actorId = recipientId,
    sourceActorId = sourceId
  ) => createNotificationWithPolicy(database, { actorId, type, sourceActorId })

  const stored = () =>
    database.getNotifications({ actorId: recipientId, limit: 40 })

  it.each([
    NotificationType.enum.follow,
    NotificationType.enum.follow_request,
    NotificationType.enum.mention,
    NotificationType.enum.reply,
    NotificationType.enum.quote,
    NotificationType.enum.added_to_collection
  ])(
    'drops a %s notification from an account the recipient muted',
    async (type) => {
      await database.createMute({
        actorId: recipientId,
        targetActorId: sourceId,
        notifications: true,
        endsAt: null
      })

      expect(await notify(type)).toBeNull()
      expect(await stored()).toHaveLength(0)
    }
  )

  it('keeps notifications when the mute leaves notifications on', async () => {
    await database.createMute({
      actorId: recipientId,
      targetActorId: sourceId,
      notifications: false,
      endsAt: null
    })

    expect(await notify()).not.toBeNull()
    expect(await stored()).toHaveLength(1)
  })

  it('keeps notifications once a timed mute has expired', async () => {
    await database.createMute({
      actorId: recipientId,
      targetActorId: sourceId,
      notifications: true,
      endsAt: Date.now() - 1_000
    })

    expect(await notify()).not.toBeNull()
  })

  it.each([
    { label: 'the recipient blocked the source', recipientBlocks: true },
    { label: 'the source blocked the recipient', recipientBlocks: false }
  ])('drops notifications when $label', async ({ recipientBlocks }) => {
    const [actorId, targetActorId] = recipientBlocks
      ? [recipientId, sourceId]
      : [sourceId, recipientId]
    await database.createBlock({
      actorId,
      targetActorId,
      uri: `${actorId}#blocks/1`
    })

    expect(await notify(NotificationType.enum.mention)).toBeNull()
    expect(await stored()).toHaveLength(0)
  })

  it('still creates self-addressed notifications', async () => {
    const notification = await notify(
      NotificationType.enum.gear_service_due,
      recipientId,
      recipientId
    )
    expect(notification).not.toBeNull()
  })
})
