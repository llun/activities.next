import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { getAccountFromSession } from '@/lib/utils/getActorFromSession'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

const account = { id: 'account-1', email: 'user@example.com' }

const databaseWith = (getAccountFromEmail: jest.Mock) =>
  ({ getAccountFromEmail }) as unknown as Database

const mockConfig = (allowEmails: string[]) => {
  vi.mocked(getConfig).mockReturnValue({ allowEmails } as never)
}

describe('getAccountFromSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when there is no signed-in email', async () => {
    mockConfig([])
    const getAccountFromEmail = vi.fn()
    const result = await getAccountFromSession(
      databaseWith(getAccountFromEmail),
      null
    )
    expect(result).toBeNull()
    expect(getAccountFromEmail).not.toHaveBeenCalled()
  })

  it('allows any signed-in email when the allowlist is empty', async () => {
    mockConfig([])
    const getAccountFromEmail = vi.fn().mockResolvedValue(account)
    const result = await getAccountFromSession(
      databaseWith(getAccountFromEmail),
      { user: { email: 'user@example.com' } }
    )
    expect(result).toEqual(account)
  })

  it.each([
    {
      description: 'the session email differs in case from the entry',
      allowEmails: ['user@example.com'],
      sessionEmail: 'USER@Example.com'
    },
    {
      description: 'the allowlist entry differs in case from the session email',
      allowEmails: ['User@Example.COM'],
      sessionEmail: 'user@example.com'
    }
  ])(
    'allows the account when $description',
    async ({ allowEmails, sessionEmail }) => {
      mockConfig(allowEmails)
      const getAccountFromEmail = vi.fn().mockResolvedValue(account)
      const result = await getAccountFromSession(
        databaseWith(getAccountFromEmail),
        { user: { email: sessionEmail } }
      )
      expect(result).toEqual(account)
      expect(getAccountFromEmail).toHaveBeenCalledWith({ email: sessionEmail })
    }
  )

  it('blocks an email that is not in the allowlist regardless of case', async () => {
    mockConfig(['allowed@example.com'])
    const getAccountFromEmail = vi.fn()
    const result = await getAccountFromSession(
      databaseWith(getAccountFromEmail),
      { user: { email: 'Blocked@Example.com' } }
    )
    expect(result).toBeNull()
    expect(getAccountFromEmail).not.toHaveBeenCalled()
  })
})
