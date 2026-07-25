import { getConfig } from '@/lib/config'

import { sendResendMail } from './resend'

const mockSend = vi.fn().mockResolvedValue({ data: { id: 'sent' } })

vi.mock('resend', () => ({
  // A real class, not an arrow: the transport calls `new Resend(token)`.
  Resend: class {
    emails = { send: mockSend }
  }
}))

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

describe('sendResendMail', () => {
  const baseConfig = mockGetConfig()
  const resendConfig = {
    type: 'resend' as const,
    serviceFromAddress: 'noreply@llun.test',
    // A distinct token per test file keeps the SDK memoization from leaking.
    token: 're_test_token'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({ ...baseConfig, email: resendConfig })
  })

  afterAll(() => {
    mockGetConfig.mockReturnValue(baseConfig)
  })

  const message = {
    from: 'noreply@llun.test',
    to: ['someone@example.tld'],
    subject: 'Hello',
    content: { text: 'text body', html: '<p>html body</p>' }
  }

  // Regression: this used to pass the wire name `reply_to`. resend-node v4
  // reads `replyTo` off the options object and emits `reply_to` itself, so the
  // old key was dropped on the floor and the header never went out — which
  // made every repliable notification unrepliable on a Resend instance.
  it('passes the reply address as replyTo, the name the SDK reads', async () => {
    await sendResendMail({ ...message, replyTo: 'reply+token@reply.llun.test' })

    expect(mockSend).toHaveBeenCalledTimes(1)
    const [options] = mockSend.mock.calls[0]
    expect(options.replyTo).toBe('reply+token@reply.llun.test')
    expect(options).not.toHaveProperty('reply_to')
  })

  it('omits the key entirely when the message has no reply address', async () => {
    await sendResendMail(message)

    const [options] = mockSend.mock.calls[0]
    expect(options).not.toHaveProperty('replyTo')
    expect(options).not.toHaveProperty('reply_to')
  })

  it('sends nothing when the configured provider is not resend', async () => {
    mockGetConfig.mockReturnValue({
      ...baseConfig,
      email: { type: 'smtp', serviceFromAddress: 'noreply@llun.test' }
    })

    await sendResendMail(message)

    expect(mockSend).not.toHaveBeenCalled()
  })
})
