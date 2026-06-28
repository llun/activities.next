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
  'getAccountFromEmail' | 'getActorsForAccount' | 'deleteOtherAccountSessions'
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

const buildRequest = () =>
  new NextRequest('http://llun.test/api/v1/accounts/sessions', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://llun.test'
    }
  })

describe('DELETE /api/v1/accounts/sessions', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    deleteOtherAccountSessions: vi.fn()
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
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([actor])
    mockDb.deleteOtherAccountSessions.mockResolvedValue(2)
  })

  it('revokes every session except the current one and reports the count', async () => {
    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ revoked: 2 })
    expect(mockDb.deleteOtherAccountSessions).toHaveBeenCalledWith({
      accountId: account.id,
      exceptToken: 'current-token'
    })
  })

  it('returns 400 when the current session token is unavailable', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const response = await DELETE(buildRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(400)
    expect(mockDb.deleteOtherAccountSessions).not.toHaveBeenCalled()
  })
})
