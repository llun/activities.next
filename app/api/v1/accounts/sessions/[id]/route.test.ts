import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { DELETE } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: []
  })
}))

type MockDatabase = Pick<
  Database,
  'getAccountFromEmail' | 'getActorsForAccount' | 'deleteAccountSessionById'
>

let mockDatabase: MockDatabase | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

const account = {
  id: 'account-1',
  email: seedActor1.email,
  defaultActorId: ACTOR1_ID
}

const actor = { ...seedActor1, id: ACTOR1_ID, account }

const buildRequest = (
  url: string = 'http://llun.test/api/v1/accounts/sessions/session-id-123'
) =>
  new NextRequest(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://llun.test'
    }
  })

describe('DELETE /api/v1/accounts/sessions/[id]', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    deleteAccountSessionById: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email },
      session: { token: 'current-token' }
    })
    mockDb.getAccountFromEmail.mockResolvedValue(account as never)
    mockDb.getActorsForAccount.mockResolvedValue([actor] as never)
    mockDb.deleteAccountSessionById.mockResolvedValue(1)
  })

  it('revokes the specified session', async () => {
    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({ id: 'session-id-123' })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'Accepted' })
    expect(mockDb.deleteAccountSessionById).toHaveBeenCalledWith({
      accountId: 'account-1',
      id: 'session-id-123'
    })
  })

  it('revokes the session when actor is suspended', async () => {
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...actor, suspendedAt: Date.now() }
    ] as never)

    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({ id: 'session-id-123' })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'Accepted' })
    expect(mockDb.deleteAccountSessionById).toHaveBeenCalledWith({
      accountId: 'account-1',
      id: 'session-id-123'
    })
  })

  it('revokes the session when account is disabled', async () => {
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...actor, account: { ...account, disabledAt: Date.now() } }
    ] as never)

    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({ id: 'session-id-123' })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'Accepted' })
    expect(mockDb.deleteAccountSessionById).toHaveBeenCalledWith({
      accountId: 'account-1',
      id: 'session-id-123'
    })
  })

  it('returns 403 when account confirmation is pending', async () => {
    mockDb.getActorsForAccount.mockResolvedValue([
      {
        ...actor,
        account: {
          ...account,
          verificationCode: 'pending-code',
          emailVerified: false
        }
      }
    ] as never)

    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({ id: 'session-id-123' })
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockDb.deleteAccountSessionById).not.toHaveBeenCalled()
  })

  // Unknown and foreign ids are indistinguishable: the delete is scoped to the
  // caller's account, so either matches no row (pinned against a real
  // database in lib/database/sql/account.test.ts).
  it('returns 404 when no session of this account has the id', async () => {
    mockDb.deleteAccountSessionById.mockResolvedValue(0)

    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({ id: 'other-session-id' })
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not Found' })
    expect(mockDb.deleteAccountSessionById).toHaveBeenCalledWith({
      accountId: 'account-1',
      id: 'other-session-id'
    })
  })

  it('returns 400 when id param is empty', async () => {
    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({ id: '' })
    })

    expect(response.status).toBe(400)
    expect(mockDb.deleteAccountSessionById).not.toHaveBeenCalled()
  })
})
