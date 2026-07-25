import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'

import { POST } from './route'

const mockSendMail = vi.fn()
vi.mock('@/lib/services/email', () => ({
  sendMail: (...args: unknown[]) => mockSendMail(...args)
}))

const mockLoggerError = vi.fn()
const mockLoggerWarn = vi.fn()
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args)
  }
}))

// This local factory shadows the global @/lib/config mock, so it has to supply
// every export the code under test reaches — including getBaseURL, which the
// shared email layout uses to build absolute links. Omitting it does not fail
// loudly: the route catches email errors, so a template that throws is
// indistinguishable from a delivery failure, and the "email sending fails"
// tests below would pass without sendMail ever being reached.
vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret-phase',
    email: {
      serviceFromAddress: 'noreply@llun.test'
    }
  })
}))

type MockDatabase = Pick<
  Database,
  'getAccountFromEmail' | 'requestPasswordReset'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('POST /api/v1/accounts/password/reset/request', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: vi.fn(),
    requestPasswordReset: vi.fn()
  }
  const buildRequest = (body: unknown) =>
    new NextRequest('http://llun.test/api/v1/accounts/password/reset/request', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://client.llun.test'
      }
    })

  const buildRawRequest = (body: string) =>
    new NextRequest('http://llun.test/api/v1/accounts/password/reset/request', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://client.llun.test'
      }
    })

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMail.mockResolvedValue(undefined)
    mockDb.getAccountFromEmail.mockResolvedValue({
      id: 'account-1',
      email: 'test@llun.test',
      passwordResetCode: 'existing-reset-code',
      passwordResetCodeExpiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    mockDb.requestPasswordReset.mockResolvedValue(true)
  })

  it('sends the reset email with a link to the reset page', async () => {
    const response = await POST(buildRequest({ email: 'test@llun.test' }))

    expect(response.status).toBe(200)
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    const message = mockSendMail.mock.calls[0][0]
    expect(message.to).toEqual(['test@llun.test'])
    expect(message.subject).toBe('Reset your password')
    // The code is generated inside the route, so match the link shape rather
    // than a fixed value.
    expect(message.content.html).toMatch(
      /href="https:\/\/llun\.test\/auth\/reset-password\?code=[^"]+"/
    )
    expect(message.content.text).toContain(
      'https://llun.test/auth/reset-password?code='
    )
  })

  it('returns uniform success and restores the reset code when email sending fails', async () => {
    mockSendMail.mockRejectedValue(new Error('mail failed'))
    const previousExpiresAt = Date.now() + 60_000
    mockDb.getAccountFromEmail.mockResolvedValue({
      id: 'account-1',
      email: 'test@llun.test',
      passwordResetCode: 'existing-reset-code',
      passwordResetCodeExpiresAt: previousExpiresAt,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    const request = buildRequest({ email: 'test@llun.test' })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      success: true,
      message:
        'If an account exists for that email, a password reset link has been sent.'
    })
    expect(mockDb.requestPasswordReset).toHaveBeenCalledTimes(2)
    expect(mockDb.requestPasswordReset).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        email: 'test@llun.test',
        passwordResetCode: expect.not.stringMatching('existing-reset-code')
      })
    )
    expect(mockDb.requestPasswordReset).toHaveBeenNthCalledWith(2, {
      email: 'test@llun.test',
      passwordResetCode: 'existing-reset-code',
      expiresAt: previousExpiresAt
    })
  })

  it('returns an error when email sending fails and reset code restoration returns false', async () => {
    mockSendMail.mockRejectedValue(new Error('mail failed'))
    mockDb.requestPasswordReset.mockResolvedValueOnce(true)
    mockDb.requestPasswordReset.mockResolvedValueOnce(false)

    const request = buildRequest({ email: 'test@llun.test' })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Internal Server Error' })
    expect(mockDb.requestPasswordReset).toHaveBeenCalledTimes(2)
  })

  it('returns an error when email sending fails and reset code restoration rejects', async () => {
    mockSendMail.mockRejectedValue(new Error('mail failed'))
    mockDb.requestPasswordReset.mockResolvedValueOnce(true)
    mockDb.requestPasswordReset.mockRejectedValueOnce(
      new Error('restore failed')
    )

    const request = buildRequest({ email: 'test@llun.test' })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Internal Server Error' })
    expect(mockDb.requestPasswordReset).toHaveBeenCalledTimes(2)
  })

  it('returns a CORS-aware bad request response for schema-invalid request bodies', async () => {
    const request = buildRequest({ email: 'not-an-email' })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Bad Request' })
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://client.llun.test'
    )
    expect(mockLoggerError).not.toHaveBeenCalled()
    expect(mockDb.getAccountFromEmail).not.toHaveBeenCalled()
    expect(mockDb.requestPasswordReset).not.toHaveBeenCalled()
  })

  it('returns a CORS-aware bad request response for malformed JSON bodies', async () => {
    const request = buildRawRequest('{')

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ error: 'Bad Request' })
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://client.llun.test'
    )
    expect(mockLoggerError).not.toHaveBeenCalled()
    expect(mockDb.getAccountFromEmail).not.toHaveBeenCalled()
    expect(mockDb.requestPasswordReset).not.toHaveBeenCalled()
  })

  it('returns a CORS-aware internal error response for account lookup failures', async () => {
    mockDb.getAccountFromEmail.mockRejectedValue(new Error('database failed'))

    const request = buildRequest({ email: 'test@llun.test' })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data).toEqual({ error: 'Internal Server Error' })
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://client.llun.test'
    )
    expect(mockLoggerError).toHaveBeenCalledWith(
      { error: expect.any(Error) },
      'Failed to request password reset'
    )
    expect(mockDb.requestPasswordReset).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})
