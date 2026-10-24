import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'

import { notifyLocalFollow } from './notifyLocalFollow'

vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

describe('notifyLocalFollow', () => {
  const { database, prepare } = createTestDatabase()
  const mockSendNotificationAlerts = vi.mocked(sendNotificationAlerts)
  let targetActor: Actor
  let followerActor: Actor

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    targetActor = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
    followerActor = (await database.getActorFromUsername({
      username: seedActor2.username,
      domain: seedActor2.domain
    })) as Actor
  })

  afterAll(async () => {
    if (database) await database.destroy()
  })

  beforeEach(() => {
    mockSendNotificationAlerts.mockClear()
  })

  it('creates a follow notification with day groupKey and sends alerts', async () => {
    const followId = 'follow-local-1'
    const notification = await notifyLocalFollow({
      database,
      targetActor,
      followerActor,
      followId,
      type: 'follow'
    })

    expect(notification).not.toBeNull()
    expect(notification).toMatchObject({
      actorId: targetActor.id,
      type: NotificationType.enum.follow,
      sourceActorId: followerActor.id,
      followId,
      filtered: false
    })
    expect(notification?.groupKey).toMatch(/^follow:/)

    expect(mockSendNotificationAlerts).toHaveBeenCalledTimes(1)
    expect(mockSendNotificationAlerts).toHaveBeenCalledWith({
      database,
      actorId: targetActor.id,
      sourceActorId: followerActor.id,
      sourceActor: followerActor,
      events: [
        {
          type: NotificationType.enum.follow,
          notificationId: notification?.id,
          emailContent: expect.objectContaining({
            recipientEmail: 'test1@llun.test'
          })
        }
      ]
    })
  })

  it('creates a follow_request notification without groupKey and sends alerts', async () => {
    const followId = 'follow-local-req-1'
    const notification = await notifyLocalFollow({
      database,
      targetActor,
      followerActor,
      followId,
      type: 'follow_request'
    })

    expect(notification).not.toBeNull()
    expect(notification).toMatchObject({
      actorId: targetActor.id,
      type: NotificationType.enum.follow_request,
      sourceActorId: followerActor.id,
      followId,
      filtered: false
    })
    expect(notification?.groupKey).toBeUndefined()

    expect(mockSendNotificationAlerts).toHaveBeenCalledTimes(1)
    expect(mockSendNotificationAlerts).toHaveBeenCalledWith({
      database,
      actorId: targetActor.id,
      sourceActorId: followerActor.id,
      sourceActor: followerActor,
      events: [
        {
          type: NotificationType.enum.follow_request,
          notificationId: notification?.id,
          emailContent: expect.objectContaining({
            recipientEmail: 'test1@llun.test'
          })
        }
      ]
    })
  })

  it('omits email content when targetActor has no account', async () => {
    const actorWithoutAccount: Actor = {
      ...targetActor,
      account: undefined
    }

    const followId = 'follow-no-account-1'
    const notification = await notifyLocalFollow({
      database,
      targetActor: actorWithoutAccount,
      followerActor,
      followId,
      type: 'follow'
    })

    expect(notification).not.toBeNull()
    expect(mockSendNotificationAlerts).toHaveBeenCalledWith({
      database,
      actorId: targetActor.id,
      sourceActorId: followerActor.id,
      sourceActor: followerActor,
      events: [
        {
          type: NotificationType.enum.follow,
          notificationId: notification?.id,
          emailContent: undefined
        }
      ]
    })
  })

  it('does not send alerts when notification is dropped by policy', async () => {
    await database.createBlock({
      actorId: targetActor.id,
      targetActorId: followerActor.id,
      uri: `${targetActor.id}#blocks/notify-test`
    })

    const followId = 'follow-blocked-1'
    const notification = await notifyLocalFollow({
      database,
      targetActor,
      followerActor,
      followId,
      type: 'follow'
    })

    expect(notification).toBeNull()
    expect(mockSendNotificationAlerts).not.toHaveBeenCalled()

    await database.deleteBlock({
      actorId: targetActor.id,
      targetActorId: followerActor.id
    })
  })
})
