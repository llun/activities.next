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
      expect.stringContaining('"title"')
    )
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
