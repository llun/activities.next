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
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'getAccountSession'
  | 'deleteAccountSession'
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
  url: string = 'http://llun.test/api/v1/accounts/sessions/session-token-123'
) =>
  new NextRequest(url, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://llun.test'
    }
  })

describe('DELETE /api/v1/accounts/sessions/[token]', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    getAccountSession: vi.fn(),
    deleteAccountSession: vi.fn()
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
    mockDb.getAccountSession.mockResolvedValue({
      token: 'session-token-123',
      account
    } as never)
    mockDb.deleteAccountSession.mockResolvedValue(undefined)
  })

  it('revokes the specified session', async () => {
    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({ token: 'session-token-123' })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'Accepted' })
    expect(mockDb.deleteAccountSession).toHaveBeenCalledWith({
      token: 'session-token-123'
    })
  })

  it('revokes the session when actor is suspended', async () => {
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...actor, suspendedAt: Date.now() }
    ] as never)

    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({ token: 'session-token-123' })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'Accepted' })
    expect(mockDb.deleteAccountSession).toHaveBeenCalledWith({
      token: 'session-token-123'
    })
  })

  it('revokes the session when account is disabled', async () => {
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...actor, account: { ...account, disabledAt: Date.now() } }
    ] as never)

    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({ token: 'session-token-123' })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'Accepted' })
    expect(mockDb.deleteAccountSession).toHaveBeenCalledWith({
      token: 'session-token-123'
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
      params: Promise.resolve({ token: 'session-token-123' })
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockDb.deleteAccountSession).not.toHaveBeenCalled()
  })

  it('returns 404 when session is not found', async () => {
    mockDb.getAccountSession.mockResolvedValue(null as never)

    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({ token: 'session-token-123' })
    })

    expect(response.status).toBe(404)
    expect(mockDb.deleteAccountSession).not.toHaveBeenCalled()
  })

  it('returns 400 when token param is empty', async () => {
    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({ token: '' })
    })

    expect(response.status).toBe(400)
    expect(mockDb.deleteAccountSession).not.toHaveBeenCalled()
  })
})
