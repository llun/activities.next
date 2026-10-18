import { getConfig } from '@/lib/config'
import { DEFAULT_SERVER_SETTINGS } from '@/lib/config/serverSettings'
import { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'

import { registerAccount } from './registerAccount'

const DEFAULT_CONFIG = {
  host: 'llun.test',
  allowEmails: [] as string[],
  registrationOpen: true,
  secretPhase: 'test-secret-phase-for-unit-tests-only',
  email: null
}

const mockLoggerError = vi.fn()

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args)
  }
}))

vi.mock('@/lib/config', async () => ({
  getConfig: vi.fn(),
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  buildBaseURL: vi.fn((host: string) => `https://${host}`)
}))

vi.mock('@/lib/services/email', async () => ({
  sendMail: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn()
}))

// Registration open/allow-list are resolved from server settings; build a
// resolved object varying only those fields.
const settingsWith = (registrations: {
  open: boolean
  allowEmails: string[]
}) => ({ ...structuredClone(DEFAULT_SERVER_SETTINGS), registrations })

type MockDatabase = Pick<
  Database,
  'isAccountExists' | 'isUsernameExists' | 'createAccount'
>

let mockDatabase: MockDatabase

beforeEach(() => {
  vi.clearAllMocks()
  // registerAccount and the shared confirmation-mail helper each read config via
  // getConfig(), so use a stable mockReturnValue (not mockReturnValueOnce) that
  // every call within a single registration resolves to.
  vi.mocked(getConfig).mockReturnValue(DEFAULT_CONFIG as never)
  vi.mocked(getResolvedServerSettings).mockResolvedValue(
    settingsWith({ open: true, allowEmails: [] })
  )
  mockDatabase = {
    isAccountExists: vi.fn().mockResolvedValue(false),
    isUsernameExists: vi.fn().mockResolvedValue(false),
    createAccount: vi.fn().mockResolvedValue('new-account-id')
  }
})

describe('registerAccount', () => {
  it('returns registration_closed when registration is disabled', async () => {
    vi.mocked(getResolvedServerSettings).mockResolvedValue(
      settingsWith({ open: false, allowEmails: [] })
    )

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
    vi.mocked(getResolvedServerSettings).mockResolvedValue(
      settingsWith({ open: true, allowEmails: ['allowed@example.com'] })
    )

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
    vi.mocked(getConfig).mockReturnValue({
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
    const { sendMail } = await vi.importMock<{ sendMail: jest.Mock }>(
      '@/lib/services/email'
    )

    await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(sendMail).not.toHaveBeenCalled()
  })

  it('sends a verification email when email service is configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      registrationOpen: true,
      secretPhase: 'test-secret-phase-for-unit-tests-only',
      email: {
        serviceFromAddress: 'noreply@llun.test'
      }
    } as never)

    const { sendMail } = await vi.importMock<{ sendMail: jest.Mock }>(
      '@/lib/services/email'
    )

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

  it('maps a raced email-constraint collision on createAccount to a 422 email error', async () => {
    // Both pre-checks pass (the racing request inserted after them), so the
    // collision only surfaces at createAccount; the re-check then identifies
    // email as the now-taken field.
    mockDatabase.createAccount = vi.fn().mockRejectedValue(
      Object.assign(new Error('UNIQUE constraint failed: accounts.email'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE'
      })
    )
    mockDatabase.isAccountExists = vi
      .fn()
      .mockResolvedValueOnce(false) // pre-check
      .mockResolvedValueOnce(true) // re-check after the collision

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

  it('maps a raced username-constraint collision on createAccount to a 422 username error', async () => {
    mockDatabase.createAccount = vi.fn().mockRejectedValue(
      Object.assign(new Error('UNIQUE constraint failed: actors.username'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE'
      })
    )
    // Email is free on the re-check; the username is the colliding field.
    mockDatabase.isUsernameExists = vi
      .fn()
      .mockResolvedValueOnce(false) // pre-check
      .mockResolvedValueOnce(true) // re-check after the collision

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
  })

  it('falls back to a generic email 422 when a raced constraint matches neither re-check', async () => {
    // The constraint fired (e.g. on an unexpected unique column) but both
    // re-checks come back free; the caller must still get a 422, not a 500.
    mockDatabase.createAccount = vi.fn().mockRejectedValue(
      Object.assign(new Error('UNIQUE constraint failed: accounts.something'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE'
      })
    )
    // isAccountExists/isUsernameExists default mocks already resolve false for
    // both the pre-check and the re-check.

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
    mockDatabase.createAccount = vi
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

  it('matches the allow-list case-insensitively when the entry differs in case', async () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      allowEmails: ['Allowed@Example.com'],
      registrationOpen: true,
      secretPhase: 'test-secret-phase-for-unit-tests-only',
      email: null
    } as never)

    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'allowed@example.COM',
      password: 'password123'
    })

    expect(result.type).toBe('success')
    expect(mockDatabase.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'allowed@example.com' })
    )
  })

  it('blocks an email not on the allow-list regardless of case', async () => {
    vi.mocked(getResolvedServerSettings).mockResolvedValue(
      settingsWith({ open: true, allowEmails: ['allowed@example.com'] })
    )

    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'NotAllowed@Example.com',
      password: 'password123'
    })

    expect(result).toEqual({ type: 'email_not_allowed' })
    expect(mockDatabase.createAccount).not.toHaveBeenCalled()
  })

  it('normalizes a mixed-case email to lowercase before the existence checks and insert', async () => {
    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: '  Alice.Example@Example.COM ',
      password: 'password123'
    })

    expect(result.type).toBe('success')
    expect(mockDatabase.isAccountExists).toHaveBeenCalledWith({
      email: 'alice.example@example.com'
    })
    expect(mockDatabase.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice.example@example.com' })
    )
  })

  // The mirror of the email test above. This service is reachable directly, not
  // only through `CreateAccountRequest` — which already lowercases — so without
  // this the `normalizeUsername` call here could be deleted with every test
  // still green. The actor id is asserted alongside the column because the
  // username is interpolated into it: normalizing one and not the other is the
  // failure this guards.
  it('normalizes a mixed-case username to lowercase before the existence checks and insert', async () => {
    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: '  MixedCase  ',
      email: 'mixed@example.com',
      password: 'password123'
    })

    expect(result.type).toBe('success')
    expect(result).toMatchObject({
      username: 'mixedcase',
      actorId: 'https://llun.test/users/mixedcase'
    })
    expect(mockDatabase.isUsernameExists).toHaveBeenCalledWith({
      username: 'mixedcase',
      domain: 'llun.test'
    })
    expect(mockDatabase.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'mixedcase' })
    )
  })

  it('still returns success if email sending fails', async () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      registrationOpen: true,
      secretPhase: 'test-secret-phase-for-unit-tests-only',
      email: {
        serviceFromAddress: 'noreply@llun.test'
      }
    } as never)

    const { sendMail } = await vi.importMock<{ sendMail: jest.Mock }>(
      '@/lib/services/email'
    )
    sendMail.mockRejectedValueOnce(new Error('SMTP failure'))

    const result = await registerAccount({
      database: mockDatabase as unknown as Database,
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123'
    })

    expect(result.type).toBe('success')
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.com',
        err: expect.any(Error)
      }),
      'Fail to send email'
    )
  })
})

describe('registerAccount on another served domain', () => {
  const EMAIL_CONFIG = {
    ...DEFAULT_CONFIG,
    trustedHosts: ['club.llun.test'],
    email: { serviceFromAddress: 'noreply@llun.test' }
  }

  const rowFor = (
    domain: string,
    overrides: Partial<{
      status: 'on' | 'off'
      signupsOpen: boolean
      allowedEmails: string[]
    }> = {}
  ) => ({
    id: `row-${domain}`,
    domain,
    status: 'on' as const,
    name: null,
    signupsOpen: true,
    allowedEmails: [] as string[],
    allowExistingUsers: false,
    lastCheckedAt: null,
    lastCheckStatus: null,
    lastCheckResult: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  })

  const databaseWith = (row: ReturnType<typeof rowFor> | null) =>
    ({
      ...mockDatabase,
      getServedDomain: vi.fn().mockResolvedValue(row)
    }) as unknown as Database

  beforeEach(() => {
    vi.mocked(getConfig).mockReturnValue(EMAIL_CONFIG as never)
    // The primary's own sign-ups are closed: another domain never falls back
    // to them, in either direction.
    vi.mocked(getResolvedServerSettings).mockResolvedValue(
      settingsWith({ open: false, allowEmails: ['boss@example.com'] })
    )
  })

  it('creates the first actor on the visited domain, under its own settings', async () => {
    const database = databaseWith(
      rowFor('run.llun.test', { allowedEmails: ['ana@example.com'] })
    )
    const result = await registerAccount({
      database,
      username: 'Ana',
      email: 'ANA@example.com',
      password: 'password123',
      host: 'run.llun.test'
    })

    expect(result).toMatchObject({
      type: 'success',
      username: 'ana',
      actorId: 'https://run.llun.test/users/ana'
    })
    expect(database.isUsernameExists).toHaveBeenCalledWith({
      username: 'ana',
      domain: 'run.llun.test'
    })
    expect(database.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'run.llun.test' })
    )
  })

  it('sends the confirmation link to the domain the visitor signed up on', async () => {
    const { setServedDomainsForTests, resetServedDomainsForTests } =
      await import('@/lib/services/domains/servedDomainSnapshot')
    setServedDomainsForTests(['run.llun.test'])
    try {
      const { sendMail } = await vi.importMock<{ sendMail: jest.Mock }>(
        '@/lib/services/email'
      )
      const result = await registerAccount({
        database: databaseWith(rowFor('run.llun.test')),
        username: 'ana',
        email: 'ana@example.com',
        password: 'password123',
        host: 'run.llun.test'
      })
      expect(result.type).toBe('success')
      const [{ content }] = sendMail.mock.calls[0]
      expect(content.text).toContain('https://run.llun.test/auth/confirmation')
    } finally {
      resetServedDomainsForTests()
    }
  })

  it('rejects an address the domain does not allow, even one the primary allows', async () => {
    const result = await registerAccount({
      database: databaseWith(
        rowFor('run.llun.test', { allowedEmails: ['ana@example.com'] })
      ),
      username: 'boss',
      email: 'boss@example.com',
      password: 'password123',
      host: 'run.llun.test'
    })
    expect(result).toEqual({ type: 'email_not_allowed' })
  })

  it.each([
    ['sign-ups are off', rowFor('run.llun.test', { signupsOpen: false })],
    ['the domain is off', rowFor('run.llun.test', { status: 'off' })],
    ['the domain has no row', null]
  ])('is closed when %s, with no fallback to the primary', async (_, row) => {
    vi.mocked(getResolvedServerSettings).mockResolvedValue(
      settingsWith({ open: true, allowEmails: [] })
    )
    const database = databaseWith(row)
    const result = await registerAccount({
      database,
      username: 'ana',
      email: 'ana@example.com',
      password: 'password123',
      host: 'run.llun.test'
    })
    expect(result).toEqual({ type: 'registration_closed' })
    expect(database.createAccount).not.toHaveBeenCalled()
  })

  it('uses the row of an ACTIVITIES_TRUSTED_HOSTS domain although it is stored off', async () => {
    const result = await registerAccount({
      database: databaseWith(rowFor('club.llun.test', { status: 'off' })),
      username: 'kim',
      email: 'kim@example.com',
      password: 'password123',
      host: 'club.llun.test'
    })
    expect(result).toMatchObject({
      type: 'success',
      actorId: 'https://club.llun.test/users/kim'
    })
  })

  it('keeps the primary on the server settings', async () => {
    vi.mocked(getResolvedServerSettings).mockResolvedValue(
      settingsWith({ open: true, allowEmails: [] })
    )
    const database = databaseWith(null)
    const result = await registerAccount({
      database,
      username: 'ana',
      email: 'ana@example.com',
      password: 'password123',
      host: 'LLUN.test'
    })
    expect(result).toMatchObject({
      type: 'success',
      actorId: 'https://llun.test/users/ana'
    })
    expect(database.getServedDomain).not.toHaveBeenCalled()
  })
})
