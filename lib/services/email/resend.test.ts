import type { Message, ResendConfig } from '@/lib/config/email'

import { sendResendMail } from './resend'

const resendMocks = vi.hoisted(() => {
  const send = vi.fn()
  const Resend = vi.fn(function Resend() {
    return { emails: { send } }
  })

  return { Resend, send }
})

vi.mock('resend', () => ({ Resend: resendMocks.Resend }))

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

const resendConfig = (token = 're_token'): ResendConfig => ({
  type: 'resend',
  serviceFromAddress: 'service@example.com',
  token
})

describe('sendResendMail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resendMocks.send.mockResolvedValue({
      data: { id: 'email-id' },
      error: null
    })
  })

  it('maps addresses and preserves HTML, text, and replyTo', async () => {
    await sendResendMail(message, resendConfig())

    expect(resendMocks.Resend).toHaveBeenCalledWith('re_token')
    expect(resendMocks.send).toHaveBeenCalledWith({
      from: '"Activities" <from@example.com>',
      to: ['first@example.com', '"Second Recipient" <second@example.com>'],
      replyTo: '"Replies" <reply@example.com>',
      subject: 'Subject',
      html: '<p>HTML</p>',
      text: 'Plain text'
    })
  })

  it('reuses the client for the same configuration object', async () => {
    const config = resendConfig()

    await sendResendMail(message, config)
    await sendResendMail(message, config)

    expect(resendMocks.Resend).toHaveBeenCalledTimes(1)
    expect(resendMocks.send).toHaveBeenCalledTimes(2)
  })

  it('omits replyTo when it is not provided', async () => {
    await sendResendMail(
      messageWithoutReplyTo,
      resendConfig('no-reply-to-token')
    )

    const sentMessage = resendMocks.send.mock.lastCall?.[0]
    expect(sentMessage).not.toHaveProperty('replyTo')
  })

  it('throws returned provider errors with their details and cause', async () => {
    const providerError = {
      name: 'validation_error',
      message: 'The from address is not verified',
      statusCode: 422
    }
    resendMocks.send.mockResolvedValueOnce({ data: null, error: providerError })

    const result = sendResendMail(message, resendConfig('error-token'))

    await expect(result).rejects.toThrow('The from address is not verified')
    await expect(result).rejects.toMatchObject({ cause: providerError })
  })

  it('propagates SDK exceptions', async () => {
    const error = new Error('Resend unavailable')
    resendMocks.send.mockRejectedValueOnce(error)

    await expect(sendResendMail(message, resendConfig())).rejects.toBe(error)
  })
})
