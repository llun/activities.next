import webpush from 'web-push'

import { Database } from '@/lib/database/types'
import { NotificationType } from '@/lib/types/database/operations'

import { sendPushNotification } from './pushNotification'

jest.mock('web-push')
const mockWebpush = webpush as jest.Mocked<typeof webpush>

jest.mock('@/lib/config')
const { getConfig } = jest.requireMock<{ getConfig: jest.Mock }>('@/lib/config')

jest.mock('./pushNotificationSettings', () => ({
  shouldSendPushForNotification: jest.fn().mockResolvedValue(true)
}))

const pushConfig = {
  host: 'llun.test',
  push: {
    vapidPublicKey: 'test-public-key',
    vapidPrivateKey: 'test-private-key',
    vapidEmail: 'admin@example.com'
  }
}

const makeDb = (overrides: Partial<jest.Mocked<Database>> = {}) =>
  ({
    getPushSubscriptionsForActor: jest.fn().mockResolvedValue([
      {
        id: 'sub1',
        actorId: 'https://llun.test/users/test1',
        endpoint: 'https://push.example.com/endpoint/abc',
        p256dh: 'key1',
        auth: 'auth1',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]),
    deletePushSubscription: jest.fn().mockResolvedValue(undefined),
    ...overrides
  }) as unknown as Database

const sourceActor = {
  id: 'https://llun.test/users/source',
  username: 'source',
  name: 'Source User'
} as never

describe('sendPushNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getConfig.mockReturnValue(pushConfig)
    mockWebpush.setVapidDetails.mockReturnValue(undefined)
    mockWebpush.sendNotification.mockResolvedValue({} as never)
  })

  it('sends a notification to all subscriptions', async () => {
    const db = makeDb()
    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    expect(mockWebpush.sendNotification).toHaveBeenCalledTimes(1)
    expect(mockWebpush.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://push.example.com/endpoint/abc'
      }),
      expect.stringContaining('"title"'),
      expect.objectContaining({ contentEncoding: expect.any(String) })
    )
  })

  it('sends a Mastodon-compatible payload with the standard fields', async () => {
    const db = makeDb({
      getPushSubscriptionsForActor: jest.fn().mockResolvedValue([
        {
          id: 'sub1',
          actorId: 'https://llun.test/users/test1',
          endpoint: 'https://push.example.com/endpoint/abc',
          p256dh: 'key1',
          auth: 'auth1',
          policy: 'all',
          alerts: { favourite: true },
          standard: true,
          accessToken: 'token-abc',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ])
    } as never)

    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor: {
        id: 'https://llun.test/users/source',
        username: 'source',
        name: 'Source User',
        iconUrl: 'https://llun.test/avatars/source.png'
      } as never,
      notificationId: 'notification-123'
    })

    expect(mockWebpush.sendNotification).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(
      mockWebpush.sendNotification.mock.calls[0][1] as string
    )
    expect(payload).toMatchObject({
      access_token: 'token-abc',
      preferred_locale: 'en',
      notification_id: 'notification-123',
      // `like` maps to the Mastodon `favourite` notification type.
      notification_type: 'favourite',
      icon: 'https://llun.test/avatars/source.png',
      title: 'New Like',
      body: 'Source User liked your post'
    })
  })

  it('falls back to an empty access_token and notification_id when absent', async () => {
    const db = makeDb()
    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    const payload = JSON.parse(
      mockWebpush.sendNotification.mock.calls[0][1] as string
    )
    expect(payload.access_token).toBe('')
    expect(payload.notification_id).toBe('')
    expect(payload.notification_type).toBe('favourite')
  })

  it('uses standard aes128gcm encoding when the subscription is standard', async () => {
    const db = makeDb({
      getPushSubscriptionsForActor: jest.fn().mockResolvedValue([
        {
          id: 'sub1',
          actorId: 'https://llun.test/users/test1',
          endpoint: 'https://push.example.com/endpoint/abc',
          p256dh: 'key1',
          auth: 'auth1',
          policy: 'all',
          alerts: { favourite: true },
          standard: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ])
    } as never)

    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    expect(mockWebpush.sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ contentEncoding: 'aes128gcm' })
    )
  })

  it('uses legacy aesgcm encoding when the subscription is not standard', async () => {
    const db = makeDb({
      getPushSubscriptionsForActor: jest.fn().mockResolvedValue([
        {
          id: 'sub1',
          actorId: 'https://llun.test/users/test1',
          endpoint: 'https://push.example.com/endpoint/abc',
          p256dh: 'key1',
          auth: 'auth1',
          policy: 'all',
          alerts: { favourite: true },
          standard: false,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ])
    } as never)

    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    expect(mockWebpush.sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ contentEncoding: 'aesgcm' })
    )
  })

  it('skips a subscription whose policy is none', async () => {
    const db = makeDb({
      getPushSubscriptionsForActor: jest.fn().mockResolvedValue([
        {
          id: 'sub1',
          actorId: 'https://llun.test/users/test1',
          endpoint: 'https://push.example.com/endpoint/abc',
          p256dh: 'key1',
          auth: 'auth1',
          policy: 'none',
          alerts: { favourite: true },
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ])
    } as never)

    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    expect(mockWebpush.sendNotification).not.toHaveBeenCalled()
  })

  it('skips a subscription that disabled the alert for this type', async () => {
    const db = makeDb({
      getPushSubscriptionsForActor: jest.fn().mockResolvedValue([
        {
          id: 'sub1',
          actorId: 'https://llun.test/users/test1',
          endpoint: 'https://push.example.com/endpoint/abc',
          p256dh: 'key1',
          auth: 'auth1',
          policy: 'all',
          // `like` maps to the Mastodon `favourite` alert, which is disabled.
          alerts: { favourite: false, mention: true },
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ])
    } as never)

    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    expect(mockWebpush.sendNotification).not.toHaveBeenCalled()
  })

  it('sends when the alert for this type is enabled', async () => {
    const db = makeDb({
      getPushSubscriptionsForActor: jest.fn().mockResolvedValue([
        {
          id: 'sub1',
          actorId: 'https://llun.test/users/test1',
          endpoint: 'https://push.example.com/endpoint/abc',
          p256dh: 'key1',
          auth: 'auth1',
          policy: 'all',
          alerts: { favourite: true },
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ])
    } as never)

    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    expect(mockWebpush.sendNotification).toHaveBeenCalledTimes(1)
  })

  it('skips activity_import when the status alert is disabled', async () => {
    const db = makeDb({
      getPushSubscriptionsForActor: jest.fn().mockResolvedValue([
        {
          id: 'sub1',
          actorId: 'https://llun.test/users/test1',
          endpoint: 'https://push.example.com/endpoint/abc',
          p256dh: 'key1',
          auth: 'auth1',
          policy: 'all',
          // activity_import maps to the Mastodon `status` alert, disabled here.
          alerts: { status: false },
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ])
    } as never)

    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.activity_import,
      sourceActor,
      skipSettingsCheck: true
    })

    expect(mockWebpush.sendNotification).not.toHaveBeenCalled()
  })

  it('skips sending when no subscriptions exist', async () => {
    const db = makeDb({
      getPushSubscriptionsForActor: jest.fn().mockResolvedValue([])
    } as never)

    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    expect(mockWebpush.sendNotification).not.toHaveBeenCalled()
  })

  it('skips sending when push is not configured', async () => {
    getConfig.mockReturnValueOnce({ host: 'llun.test' })

    const db = makeDb()
    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    expect(db.getPushSubscriptionsForActor).not.toHaveBeenCalled()
    expect(mockWebpush.sendNotification).not.toHaveBeenCalled()
  })

  it('deletes expired subscription on 410 response', async () => {
    mockWebpush.sendNotification.mockRejectedValue(
      Object.assign(new Error('Gone'), { statusCode: 410 })
    )

    const db = makeDb()
    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    expect(db.deletePushSubscription).toHaveBeenCalledWith({
      endpoint: 'https://push.example.com/endpoint/abc',
      actorId: 'https://llun.test/users/test1'
    })
  })

  it('deletes expired subscription on 404 response', async () => {
    mockWebpush.sendNotification.mockRejectedValue(
      Object.assign(new Error('Not Found'), { statusCode: 404 })
    )

    const db = makeDb()
    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    expect(db.deletePushSubscription).toHaveBeenCalledWith({
      endpoint: 'https://push.example.com/endpoint/abc',
      actorId: 'https://llun.test/users/test1'
    })
  })

  it('does not delete subscription on other errors', async () => {
    mockWebpush.sendNotification.mockRejectedValue(
      Object.assign(new Error('Server Error'), { statusCode: 500 })
    )

    const db = makeDb()
    await sendPushNotification({
      database: db,
      actorId: 'https://llun.test/users/test1',
      type: NotificationType.enum.like,
      sourceActor
    })

    expect(db.deletePushSubscription).not.toHaveBeenCalled()
  })
})
