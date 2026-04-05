import { Database } from '@/lib/database/types'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'

import { shouldSendEmailForNotification } from './emailNotificationSettings'
import { sendPushNotification } from './pushNotification'
import { shouldSendPushForNotification } from './pushNotificationSettings'
import { sendNotificationAlerts } from './sendNotificationAlerts'

jest.mock('@/lib/config')
const { getConfig } = jest.requireMock<{ getConfig: jest.Mock }>('@/lib/config')

jest.mock('./pushNotification', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined)
}))

jest.mock('./pushNotificationSettings', () => ({
  shouldSendPushForNotification: jest.fn().mockResolvedValue(true)
}))

jest.mock('./emailNotificationSettings', () => ({
  shouldSendEmailForNotification: jest.fn().mockResolvedValue(true)
}))

jest.mock('@/lib/services/email', () => ({
  sendMail: jest.fn().mockResolvedValue(undefined)
}))
const { sendMail } = jest.requireMock<{ sendMail: jest.Mock }>(
  '@/lib/services/email'
)

const mockSendPush = sendPushNotification as jest.MockedFunction<
  typeof sendPushNotification
>
const mockShouldSendPush = shouldSendPushForNotification as jest.MockedFunction<
  typeof shouldSendPushForNotification
>
const mockShouldSendEmail =
  shouldSendEmailForNotification as jest.MockedFunction<
    typeof shouldSendEmailForNotification
  >

const sourceActor = {
  id: 'https://llun.test/users/source',
  username: 'source',
  name: 'Source User'
} as Actor

const makeDb = (overrides: Partial<jest.Mocked<Database>> = {}) =>
  ({
    getActorFromId: jest.fn().mockResolvedValue(sourceActor),
    ...overrides
  }) as unknown as Database

const baseConfig = { host: 'llun.test' }
const emailConfig = {
  ...baseConfig,
  email: { serviceFromAddress: 'noreply@llun.test' }
}

// Wait for fire-and-forget promise chains
const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve))

describe('sendNotificationAlerts', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getConfig.mockReturnValue(emailConfig)
  })

  it('does nothing when events array is empty', async () => {
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      events: []
    })
    await flushPromises()

    expect(db.getActorFromId).not.toHaveBeenCalled()
    expect(mockSendPush).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('sends push notification for the first event only', async () => {
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      statusId: 'status1',
      events: [
        { type: NotificationType.enum.reply },
        { type: NotificationType.enum.mention }
      ]
    })
    await flushPromises()

    expect(mockSendPush).toHaveBeenCalledTimes(1)
    expect(mockSendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'actor1',
        type: NotificationType.enum.reply,
        sourceActor,
        statusId: 'status1'
      })
    )
  })

  it('uses provided sourceActor without DB fetch', async () => {
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      sourceActor,
      events: [{ type: NotificationType.enum.like }]
    })
    await flushPromises()

    expect(db.getActorFromId).not.toHaveBeenCalled()
    expect(mockSendPush).toHaveBeenCalledTimes(1)
  })

  it('fetches sourceActor from DB when not provided', async () => {
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      events: [{ type: NotificationType.enum.follow }]
    })
    await flushPromises()

    expect(db.getActorFromId).toHaveBeenCalledWith({ id: 'source1' })
    expect(mockSendPush).toHaveBeenCalledTimes(1)
  })

  it('sends email for events with emailContent', async () => {
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      events: [
        {
          type: NotificationType.enum.mention,
          emailContent: {
            recipientEmail: 'user@example.com',
            subject: 'You were mentioned',
            text: 'Hello text',
            html: '<p>Hello html</p>'
          }
        }
      ]
    })
    await flushPromises()

    expect(mockShouldSendEmail).toHaveBeenCalledWith(
      db,
      'actor1',
      NotificationType.enum.mention
    )
    expect(sendMail).toHaveBeenCalledWith({
      from: 'noreply@llun.test',
      to: ['user@example.com'],
      subject: 'You were mentioned',
      content: { text: 'Hello text', html: '<p>Hello html</p>' }
    })
  })

  it('skips email when emailContent is not provided', async () => {
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      events: [{ type: NotificationType.enum.reply }]
    })
    await flushPromises()

    expect(sendMail).not.toHaveBeenCalled()
  })

  it('skips email when email is not configured', async () => {
    getConfig.mockReturnValue(baseConfig)
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      events: [
        {
          type: NotificationType.enum.mention,
          emailContent: {
            recipientEmail: 'user@example.com',
            subject: 'Sub',
            text: 'Txt',
            html: '<p>Html</p>'
          }
        }
      ]
    })
    await flushPromises()

    expect(sendMail).not.toHaveBeenCalled()
  })

  it('skips email when user setting disables it', async () => {
    mockShouldSendEmail.mockResolvedValueOnce(false)
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      events: [
        {
          type: NotificationType.enum.mention,
          emailContent: {
            recipientEmail: 'user@example.com',
            subject: 'Sub',
            text: 'Txt',
            html: '<p>Html</p>'
          }
        }
      ]
    })
    await flushPromises()

    expect(sendMail).not.toHaveBeenCalled()
  })

  it('sends push + email together for a single event', async () => {
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      statusId: 'status1',
      events: [
        {
          type: NotificationType.enum.mention,
          emailContent: {
            recipientEmail: 'user@example.com',
            subject: 'Mentioned',
            text: 'text',
            html: '<p>html</p>'
          }
        }
      ]
    })
    await flushPromises()

    expect(mockSendPush).toHaveBeenCalledTimes(1)
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('sends one push and multiple emails for multiple events with emailContent', async () => {
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      events: [
        {
          type: NotificationType.enum.reply,
          emailContent: {
            recipientEmail: 'user@example.com',
            subject: 'Reply',
            text: 'reply text',
            html: '<p>reply</p>'
          }
        },
        {
          type: NotificationType.enum.mention,
          emailContent: {
            recipientEmail: 'user@example.com',
            subject: 'Mention',
            text: 'mention text',
            html: '<p>mention</p>'
          }
        }
      ]
    })
    await flushPromises()

    expect(mockSendPush).toHaveBeenCalledTimes(1)
    expect(mockSendPush).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationType.enum.reply })
    )
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it('skips push when sourceActor is not found', async () => {
    const db = makeDb({
      getActorFromId: jest.fn().mockResolvedValue(undefined)
    } as never)
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      events: [{ type: NotificationType.enum.like }]
    })
    await flushPromises()

    expect(mockSendPush).not.toHaveBeenCalled()
  })

  it('falls back to next event when first event push is disabled', async () => {
    // User disabled reply push but enabled mention push
    mockShouldSendPush
      .mockResolvedValueOnce(false) // reply → disabled
      .mockResolvedValueOnce(true) // mention → enabled
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      statusId: 'status1',
      events: [
        { type: NotificationType.enum.reply },
        { type: NotificationType.enum.mention }
      ]
    })
    await flushPromises()

    expect(mockShouldSendPush).toHaveBeenCalledTimes(2)
    expect(mockSendPush).toHaveBeenCalledTimes(1)
    expect(mockSendPush).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationType.enum.mention })
    )
  })

  it('sends no push when all event types are disabled', async () => {
    mockShouldSendPush.mockResolvedValue(false)
    const db = makeDb()
    sendNotificationAlerts({
      database: db,
      actorId: 'actor1',
      sourceActorId: 'source1',
      events: [
        { type: NotificationType.enum.reply },
        { type: NotificationType.enum.mention }
      ]
    })
    await flushPromises()

    expect(mockSendPush).not.toHaveBeenCalled()
  })
})
