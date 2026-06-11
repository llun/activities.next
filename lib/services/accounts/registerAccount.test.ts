import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'

import { registerAccount } from './registerAccount'

const DEFAULT_CONFIG = {
  host: 'llun.test',
  allowEmails: [] as string[],
  registrationOpen: true,
  secretPhase: 'test-secret-phase-for-unit-tests-only',
  email: null
}

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  getBaseURL: jest.fn().mockReturnValue('https://llun.test')
}))

jest.mock('@/lib/services/email', () => ({
  sendMail: jest.fn().mockResolvedValue(undefined)
}))

type MockDatabase = Pick<
  Database,
  'isAccountExists' | 'isUsernameExists' | 'createAccount'
>

let mockDatabase: MockDatabase

beforeEach(() => {
  jest.clearAllMocks()
  // registerAccount and the shared confirmation-mail helper each read config via
  // getConfig(), so use a stable mockReturnValue (not mockReturnValueOnce) that
  // every call within a single registration resolves to.
  jest.mocked(getConfig).mockReturnValue(DEFAULT_CONFIG as never)
  mockDatabase = {
    isAccountExists: jest.fn().mockResolvedValue(false),
    isUsernameExists: jest.fn().mockResolvedValue(false),
    createAccount: jest.fn().mockResolvedValue('new-account-id')
  }
})

describe('registerAccount', () => {
  it('returns registration_closed when registration is disabled', async () => {
    jest.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      registrationOpen: false,
      secretPhase: 'test-secret',
      email: null
    } as never)

    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(result).toEqual({ type: 'registration_closed' })
    expect(mockDatabase.createAccount).not.toHaveBeenCalled()
  })

  it('returns email_not_allowed when email is not on the allow-list', async () => {
    jest.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      allowEmails: ['allowed@example.com'],
      registrationOpen: true,
      secretPhase: 'test-secret',
      email: null
    } as never)

    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(result).toEqual({ type: 'email_not_allowed' })
    expect(mockDatabase.createAccount).not.toHaveBeenCalled()
  })

  it('returns email_not_allowed only when the allow-list is non-empty and the email is absent', async () => {
    jest.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      registrationOpen: true,
      secretPhase: 'test-secret-phase-for-unit-tests-only',
      email: null
    } as never)

    // empty allowEmails means everyone is allowed — should not block
    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(result.type).toBe('success')
  })

  it('returns validation_failed with email error when email is already taken', async () => {
    ;(mockDatabase.isAccountExists as jest.Mock).mockResolvedValue(true)

    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(result).toEqual({
      type: 'validation_failed',
      details: {
        email: [{ error: 'ERR_TAKEN', description: 'Email is already taken' }]
      }
    })
    expect(mockDatabase.createAccount).not.toHaveBeenCalled()
  })

  it('returns validation_failed with username error when username is already taken', async () => {
    ;(mockDatabase.isUsernameExists as jest.Mock).mockResolvedValue(true)

    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(result).toEqual({
      type: 'validation_failed',
      details: {
        username: [
          { error: 'ERR_TAKEN', description: 'Username is already taken' }
        ]
      }
    })
    expect(mockDatabase.createAccount).not.toHaveBeenCalled()
  })

  it('returns validation_failed with both errors when email and username are taken', async () => {
    ;(mockDatabase.isAccountExists as jest.Mock).mockResolvedValue(true)
    ;(mockDatabase.isUsernameExists as jest.Mock).mockResolvedValue(true)

    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(result).toEqual({
      type: 'validation_failed',
      details: {
        email: [{ error: 'ERR_TAKEN', description: 'Email is already taken' }],
        username: [
          { error: 'ERR_TAKEN', description: 'Username is already taken' }
        ]
      }
    })
    expect(mockDatabase.createAccount).not.toHaveBeenCalled()
  })

  it('creates an account and returns success on valid registration', async () => {
    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(result).toMatchObject({
      type: 'success',
      accountId: 'new-account-id',
      username: 'alice',
      // Matches the actor createAccount derives from domain/username.
      actorId: 'https://llun.test/users/alice'
    })
    expect(mockDatabase.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'alice@example.com',
        username: 'alice',
        domain: 'llun.test'
      })
    )
  })

  it('creates an account with name when provided', async () => {
    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
      name: 'Alice Example'
    })

    expect(result.type).toBe('success')
    expect(mockDatabase.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Alice Example' })
    )
  })

  it('does not send email when email service is not configured', async () => {
    const { sendMail } = jest.requireMock('@/lib/services/email')

    await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(sendMail).not.toHaveBeenCalled()
  })

  it('sends a verification email when email service is configured', async () => {
    jest.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      registrationOpen: true,
      secretPhase: 'test-secret-phase-for-unit-tests-only',
      email: {
        serviceFromAddress: 'noreply@llun.test'
      }
    } as never)

    const { sendMail } = jest.requireMock('@/lib/services/email')

    await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@llun.test',
        to: ['alice@example.com'],
        subject: 'Email verification'
      })
    )
  })

  it('maps a concurrent unique-constraint collision on createAccount to validation_failed', async () => {
    // Both pre-checks pass (the racing request inserted after them), so the
    // collision only surfaces at createAccount.
    mockDatabase.createAccount = jest.fn().mockRejectedValue(
      Object.assign(new Error('UNIQUE constraint failed: accounts.email'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE'
      })
    )

    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(result).toEqual({
      type: 'validation_failed',
      details: {
        email: [{ error: 'ERR_TAKEN', description: 'Email is already taken' }]
      }
    })
  })

  it('rethrows a non-unique-constraint error from createAccount', async () => {
    mockDatabase.createAccount = jest
      .fn()
      .mockRejectedValue(new Error('connection reset'))

    await expect(
      registerAccount({
        database: mockDatabase as unknown as Database,
        username: 'alice',
        email: 'alice@example.com',
        password: 'password123'
      })
    ).rejects.toThrow('connection reset')
  })

  it('still returns success if email sending fails', async () => {
    jest.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      registrationOpen: true,
      secretPhase: 'test-secret-phase-for-unit-tests-only',
      email: {
        serviceFromAddress: 'noreply@llun.test'
      }
    } as never)

    const { sendMail } = jest.requireMock('@/lib/services/email')
    sendMail.mockRejectedValueOnce(new Error('SMTP failure'))

    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(result.type).toBe('success')
  })
})
