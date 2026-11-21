import { Database } from '@/lib/database/types'

import { getAdminFromSession } from './getAdminFromSession'

const mockGetAccountFromSession = vi.fn()
const mockGetActorFromSession = vi.fn()
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getAccountFromSession: (...args: unknown[]) =>
    mockGetAccountFromSession(...args),
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

const database = {} as Database
const session = { user: { email: 'admin@llun.test' } }

const admin = (overrides: Record<string, unknown> = {}) => ({
  id: 'account-1',
  role: 'admin',
  disabledAt: null,
  verificationCode: '',
  emailVerified: true,
  ...overrides
})

const actor = (overrides: Record<string, unknown> = {}) => ({
  id: 'https://llun.test/users/admin',
  suspendedAt: null,
  account: { disabledAt: null },
  ...overrides
})

describe('getAdminFromSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccountFromSession.mockResolvedValue(admin())
    mockGetActorFromSession.mockResolvedValue(actor())
  })

  it('returns null without an account', async () => {
    mockGetAccountFromSession.mockResolvedValue(null)

    await expect(getAdminFromSession(database, session)).resolves.toBeNull()
  })

  it('returns null for a non-admin account', async () => {
    mockGetAccountFromSession.mockResolvedValue(admin({ role: 'user' }))

    await expect(getAdminFromSession(database, session)).resolves.toBeNull()
  })

  it('returns the admin account when the account and actor may act', async () => {
    const account = admin()
    mockGetAccountFromSession.mockResolvedValue(account)

    await expect(getAdminFromSession(database, session)).resolves.toBe(account)
  })

  it('returns null for a disabled admin account', async () => {
    mockGetAccountFromSession.mockResolvedValue(admin({ disabledAt: 1 }))

    await expect(getAdminFromSession(database, session)).resolves.toBeNull()
  })

  it('returns null for an unconfirmed admin account', async () => {
    mockGetAccountFromSession.mockResolvedValue(
      admin({ verificationCode: 'pending-code', emailVerified: false })
    )

    await expect(getAdminFromSession(database, session)).resolves.toBeNull()
  })

  it('returns null when the active actor is suspended', async () => {
    mockGetActorFromSession.mockResolvedValue(actor({ suspendedAt: 1 }))

    await expect(getAdminFromSession(database, session)).resolves.toBeNull()
  })

  it('returns null when the active actor belongs to a disabled account', async () => {
    mockGetActorFromSession.mockResolvedValue(
      actor({ account: { disabledAt: 1 } })
    )

    await expect(getAdminFromSession(database, session)).resolves.toBeNull()
  })

  it('returns the admin account when it owns no actor', async () => {
    // AdminApiGuard allows a cookie-session admin with no actor; the
    // actor-requiring handlers 422 instead.
    mockGetActorFromSession.mockResolvedValue(null)

    await expect(getAdminFromSession(database, session)).resolves.toEqual(
      admin()
    )
  })
})
