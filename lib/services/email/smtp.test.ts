import type { Message, SMTPConfig } from '@/lib/config/email'

import { sendSMTPMail } from './smtp'

const smtpMocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn()
}))

vi.mock('nodemailer', () => ({
  default: { createTransport: smtpMocks.createTransport }
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

const smtpConfig = (): SMTPConfig => ({
  type: 'smtp',
  serviceFromAddress: 'service@example.com',
  host: 'smtp.example.com',
  port: 587,
  secure: true
})

describe('sendSMTPMail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    smtpMocks.createTransport.mockReturnValue({ sendMail: smtpMocks.sendMail })
  })

  it('maps addresses and preserves both message formats and replyTo', async () => {
    const config = smtpConfig()

    await sendSMTPMail(message, config)

    expect(smtpMocks.createTransport).toHaveBeenCalledWith(config)
    expect(smtpMocks.sendMail).toHaveBeenCalledWith({
      from: '"Activities" <from@example.com>',
      to: 'first@example.com, "Second Recipient" <second@example.com>',
      replyTo: '"Replies" <reply@example.com>',
      subject: 'Subject',
      text: 'Plain text',
      html: '<p>HTML</p>'
    })
  })

  it('reuses the transporter for the same configuration object', async () => {
    const config = smtpConfig()

    await sendSMTPMail(message, config)
    await sendSMTPMail(message, config)

    expect(smtpMocks.createTransport).toHaveBeenCalledTimes(1)
    expect(smtpMocks.sendMail).toHaveBeenCalledTimes(2)
  })

  it('omits replyTo when it is not provided', async () => {
    await sendSMTPMail(messageWithoutReplyTo, smtpConfig())

    const sentMessage = smtpMocks.sendMail.mock.lastCall?.[0]
    expect(sentMessage).not.toHaveProperty('replyTo')
  })

  it('propagates SMTP exceptions', async () => {
    const error = new Error('SMTP unavailable')
    smtpMocks.sendMail.mockRejectedValueOnce(error)

    await expect(sendSMTPMail(message, smtpConfig())).rejects.toBe(error)
  })
})
