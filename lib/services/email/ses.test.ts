import type { Message, SESConfig } from '@/lib/config/email'

import { sendSESMail } from './ses'

const sesMocks = vi.hoisted(() => {
  const send = vi.fn()
  const SESClient = vi.fn(function SESClient() {
    return { send }
  })
  const SendEmailCommand = vi.fn(function SendEmailCommand(input: unknown) {
    return input
  })

  return { SESClient, SendEmailCommand, send }
})

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: sesMocks.SESClient,
  SendEmailCommand: sesMocks.SendEmailCommand
}))

const message: Message = {
  from: { name: 'Activities', email: 'from@example.com' },
  to: [
    'first@example.com',
    { name: 'Second Recipient', email: 'second@example.com' }
  ],
  replyTo: { name: 'Replies', email: 'reply@example.com' },
  subject: 'Subject',
  content: { text: 'Plain text', html: '<p>HTML</p>' }
}

const messageWithoutReplyTo: Message = {
  from: message.from,
  to: message.to,
  subject: message.subject,
  content: message.content
}

const sesConfig = (region = 'eu-west-1'): SESConfig => ({
  type: 'ses',
  serviceFromAddress: 'service@example.com',
  region
})

describe('sendSESMail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sesMocks.send.mockResolvedValue({})
  })

  it('maps addresses, message formats, and optional replyTo for SES', async () => {
    const config = sesConfig()

    await sendSESMail(message, config)

    expect(sesMocks.SESClient).toHaveBeenCalledWith({ region: 'eu-west-1' })
    expect(sesMocks.SendEmailCommand).toHaveBeenCalledWith({
      Source: '"Activities" <from@example.com>',
      Destination: {
        ToAddresses: [
          'first@example.com',
          '"Second Recipient" <second@example.com>'
        ]
      },
      ReplyToAddresses: ['"Replies" <reply@example.com>'],
      Message: {
        Subject: { Data: 'Subject', Charset: 'UTF-8' },
        Body: {
          Text: { Data: 'Plain text', Charset: 'UTF-8' },
          Html: { Data: '<p>HTML</p>', Charset: 'UTF-8' }
        }
      }
    })
  })

  it('reuses the client for the same region', async () => {
    const config = sesConfig('reuse-region')

    await sendSESMail(message, config)
    await sendSESMail(message, config)

    expect(sesMocks.SESClient).toHaveBeenCalledTimes(1)
    expect(sesMocks.send).toHaveBeenCalledTimes(2)
  })

  it('omits ReplyToAddresses when replyTo is not provided', async () => {
    await sendSESMail(messageWithoutReplyTo, sesConfig('no-reply-to-region'))

    const commandInput = sesMocks.SendEmailCommand.mock.lastCall?.[0]
    expect(commandInput).not.toHaveProperty('ReplyToAddresses')
  })

  it('propagates SES exceptions', async () => {
    const error = new Error('SES unavailable')
    sesMocks.send.mockRejectedValueOnce(error)

    await expect(sendSESMail(message, sesConfig('error-region'))).rejects.toBe(
      error
    )
  })
})
