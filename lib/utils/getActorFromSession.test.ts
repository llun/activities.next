import { DEFAULT_SERVER_SETTINGS } from '@/lib/config/serverSettings'
import { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { getAccountFromSession } from '@/lib/utils/getActorFromSession'

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn()
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

const account = { id: 'account-1', email: 'user@example.com' }

const databaseWith = (getAccountFromEmail: jest.Mock) =>
  ({ getAccountFromEmail }) as unknown as Database

const mockAllowEmails = (allowEmails: string[]) => {
  vi.mocked(getResolvedServerSettings).mockResolvedValue({
    ...structuredClone(DEFAULT_SERVER_SETTINGS),
    registrations: { open: true, allowEmails }
  })
}

describe('getAccountFromSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when there is no signed-in email', async () => {
    mockAllowEmails([])
    const getAccountFromEmail = vi.fn()
    const result = await getAccountFromSession(
      databaseWith(getAccountFromEmail),
      null
    )
    expect(result).toBeNull()
    expect(getAccountFromEmail).not.toHaveBeenCalled()
  })

  it('allows any signed-in email when the allowlist is empty', async () => {
    mockAllowEmails([])
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
      mockAllowEmails(allowEmails)
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
    mockAllowEmails(['allowed@example.com'])
    const getAccountFromEmail = vi.fn()
    const result = await getAccountFromSession(
      databaseWith(getAccountFromEmail),
      { user: { email: 'Blocked@Example.com' } }
    )
    expect(result).toBeNull()
    expect(getAccountFromEmail).not.toHaveBeenCalled()
  })
})
