import { getConfig } from '@/lib/config'
import { TYPE_RESEND, TYPE_SES, TYPE_SMTP } from '@/lib/config/email'
import type { Message } from '@/lib/config/email'

import { sendMail } from './index'

const adapterMocks = vi.hoisted(() => ({
  sendResendMail: vi.fn(),
  sendSESMail: vi.fn(),
  sendSMTPMail: vi.fn()
}))

vi.mock('./resend', () => ({
  sendResendMail: adapterMocks.sendResendMail
}))
vi.mock('./ses', () => ({ sendSESMail: adapterMocks.sendSESMail }))
vi.mock('./smtp', () => ({ sendSMTPMail: adapterMocks.sendSMTPMail }))

const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>

const message: Message = {
  from: { name: 'Activities', email: 'from@example.com' },
  to: ['to@example.com'],
  subject: 'Subject',
  content: { text: 'Text', html: '<p>HTML</p>' }
}

const configWithEmail = (email: unknown) =>
  ({ email }) as ReturnType<typeof getConfig>

describe('sendMail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when email is not configured', async () => {
    mockGetConfig.mockReturnValue(configWithEmail(undefined))

    await sendMail(message)

    expect(adapterMocks.sendSMTPMail).not.toHaveBeenCalled()
    expect(adapterMocks.sendResendMail).not.toHaveBeenCalled()
    expect(adapterMocks.sendSESMail).not.toHaveBeenCalled()
  })

  it.each([
    { type: TYPE_SMTP, adapter: adapterMocks.sendSMTPMail },
    { type: TYPE_RESEND, adapter: adapterMocks.sendResendMail },
    { type: TYPE_SES, adapter: adapterMocks.sendSESMail }
  ])(
    'selects the $type adapter and passes its config',
    async ({ type, adapter }) => {
      const email = {
        type,
        serviceFromAddress: 'service@example.com',
        ...(type === TYPE_RESEND ? { token: 're_token' } : {}),
        ...(type === TYPE_SES ? { region: 'eu-west-1' } : {}),
        ...(type === TYPE_SMTP ? { host: 'smtp.example.com' } : {})
      }
      mockGetConfig.mockReturnValue(configWithEmail(email))

      await sendMail(message)

      expect(mockGetConfig).toHaveBeenCalledTimes(1)
      expect(adapter).toHaveBeenCalledWith(message, email)
      for (const candidate of [
        adapterMocks.sendSMTPMail,
        adapterMocks.sendResendMail,
        adapterMocks.sendSESMail
      ]) {
        if (candidate !== adapter) expect(candidate).not.toHaveBeenCalled()
      }
    }
  )

  it('rejects an unsupported provider returned by the config boundary', async () => {
    mockGetConfig.mockReturnValue(configWithEmail({ type: 'lambda' }))

    await expect(sendMail(message)).rejects.toThrow(
      'Unsupported email type "lambda"'
    )
  })
})
