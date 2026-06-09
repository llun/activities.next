import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'

import { POST } from './route'

const mockSendMail = jest.fn()
jest.mock('@/lib/services/email', () => ({
  sendMail: (...args: unknown[]) => mockSendMail(...args)
}))

const mockLoggerError = jest.fn()
const mockLoggerWarn = jest.fn()
jest.mock('@/lib/utils/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args)
  }
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({
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
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

describe('POST /api/v1/accounts/password/reset/request', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: jest.fn(),
    requestPasswordReset: jest.fn()
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
    jest.clearAllMocks()
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
    expect(data).toEqual({ status: 'Internal Server Error' })
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
    expect(data).toEqual({ status: 'Internal Server Error' })
    expect(mockDb.requestPasswordReset).toHaveBeenCalledTimes(2)
  })

  it('returns a CORS-aware bad request response for schema-invalid request bodies', async () => {
    const request = buildRequest({ email: 'not-an-email' })

    const response = await POST(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toEqual({ status: 'Bad Request' })
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
    expect(data).toEqual({ status: 'Bad Request' })
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
    expect(data).toEqual({ status: 'Internal Server Error' })
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
