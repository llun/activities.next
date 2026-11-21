import { Database } from '@/lib/database/types'

import {
  resolveOptionalSessionActor,
  resolveSessionAccount,
  resolveSessionActor
} from './sessionActor'

const mockGetServerAuthSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerAuthSession()
}))

const mockGetActorFromSession = vi.fn()
const mockGetAccountFromSession = vi.fn()
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args),
  getAccountFromSession: (...args: unknown[]) =>
    mockGetAccountFromSession(...args)
}))

const database = {} as Database
const session = {
  user: { email: 'test1@llun.test' },
  session: { token: 'session-token' }
}

const actor = (overrides: Record<string, unknown> = {}) => ({
  id: 'https://llun.test/users/test1',
  suspendedAt: null,
  account: { disabledAt: null },
  ...overrides
})

describe('resolveSessionActor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is unauthenticated without a session', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)

    await expect(resolveSessionActor(database)).resolves.toEqual({
      type: 'unauthenticated'
    })
    expect(mockGetActorFromSession).not.toHaveBeenCalled()
  })

  it('is unauthenticated when the session resolves no actor', async () => {
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetActorFromSession.mockResolvedValue(null)

    await expect(resolveSessionActor(database)).resolves.toEqual({
      type: 'unauthenticated'
    })
  })

  it('blocks a suspended actor', async () => {
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetActorFromSession.mockResolvedValue(actor({ suspendedAt: 1 }))

    await expect(resolveSessionActor(database)).resolves.toEqual({
      type: 'blocked'
    })
  })

  it('blocks an actor whose account is disabled', async () => {
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetActorFromSession.mockResolvedValue(
      actor({ account: { disabledAt: 1 } })
    )

    await expect(resolveSessionActor(database)).resolves.toEqual({
      type: 'blocked'
    })
  })

  it('blocks an unconfirmed account', async () => {
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetActorFromSession.mockResolvedValue(
      actor({
        account: {
          disabledAt: null,
          verificationCode: 'pending-code',
          emailVerified: false
        }
      })
    )

    await expect(resolveSessionActor(database)).resolves.toEqual({
      type: 'blocked'
    })
  })

  it('returns the actor and session when the account may act', async () => {
    const allowed = actor()
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetActorFromSession.mockResolvedValue(allowed)

    await expect(resolveSessionActor(database)).resolves.toEqual({
      type: 'actor',
      actor: allowed,
      session
    })
  })
})

describe('resolveOptionalSessionActor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('downgrades a blocked session to the anonymous path', async () => {
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetActorFromSession.mockResolvedValue(actor({ suspendedAt: 1 }))

    await expect(resolveOptionalSessionActor(database)).resolves.toBeNull()
  })

  it('returns the actor when the account may act', async () => {
    const allowed = actor()
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetActorFromSession.mockResolvedValue(allowed)

    await expect(resolveOptionalSessionActor(database)).resolves.toBe(allowed)
  })
})

describe('resolveSessionAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is unauthenticated without a session', async () => {
    mockGetServerAuthSession.mockResolvedValue(null)

    await expect(resolveSessionAccount(database)).resolves.toEqual({
      type: 'unauthenticated'
    })
    expect(mockGetAccountFromSession).not.toHaveBeenCalled()
  })

  it('is unauthenticated when no account resolves', async () => {
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetAccountFromSession.mockResolvedValue(null)

    await expect(resolveSessionAccount(database)).resolves.toEqual({
      type: 'unauthenticated'
    })
  })

  it('returns the account and session without selecting an actor', async () => {
    const account = { id: 'account-1' }
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetAccountFromSession.mockResolvedValue(account)

    await expect(resolveSessionAccount(database)).resolves.toEqual({
      type: 'account',
      account,
      session
    })
    expect(mockGetActorFromSession).not.toHaveBeenCalled()
  })

  it('blocks an unconfirmed account', async () => {
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetAccountFromSession.mockResolvedValue({
      id: 'account-1',
      verificationCode: 'pending-code',
      emailVerified: false
    })

    await expect(resolveSessionAccount(database)).resolves.toEqual({
      type: 'blocked'
    })
  })

  it('blocks a disabled account', async () => {
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetAccountFromSession.mockResolvedValue({
      id: 'account-1',
      disabledAt: 1
    })

    await expect(resolveSessionAccount(database)).resolves.toEqual({
      type: 'blocked'
    })
  })

  it('allows a disabled account when the caller opts in', async () => {
    const account = { id: 'account-1', disabledAt: 1 }
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetAccountFromSession.mockResolvedValue(account)

    await expect(
      resolveSessionAccount(database, { allowDisabled: true })
    ).resolves.toEqual({ type: 'account', account, session })
  })

  it('still blocks an unconfirmed account when disabled is allowed', async () => {
    mockGetServerAuthSession.mockResolvedValue(session)
    mockGetAccountFromSession.mockResolvedValue({
      id: 'account-1',
      disabledAt: 1,
      verificationCode: 'pending-code',
      emailVerified: false
    })

    await expect(
      resolveSessionAccount(database, { allowDisabled: true })
    ).resolves.toEqual({ type: 'blocked' })
  })
})
