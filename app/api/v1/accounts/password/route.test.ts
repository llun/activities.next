import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockBcryptCompare = vi.fn()
const mockBcryptHash = vi.fn()
vi.mock('bcrypt', () => ({
  __esModule: true,
  default: {
    compare: (...args: unknown[]) => mockBcryptCompare(...args),
    hash: (...args: unknown[]) => mockBcryptHash(...args)
  }
}))

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
  'changePassword' | 'getAccountFromEmail' | 'getActorsForAccount'
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
  defaultActorId: ACTOR1_ID,
  passwordHash: 'password-hash',
  createdAt: Date.now(),
  updatedAt: Date.now()
}

const actor = {
  ...seedActor1,
  id: ACTOR1_ID,
  account,
  followersUrl: `${ACTOR1_ID}/followers`,
  inboxUrl: `${ACTOR1_ID}/inbox`,
  sharedInboxUrl: 'https://llun.test/inbox',
  statusCount: 0,
  lastStatusAt: null,
  createdAt: Date.now(),
  updatedAt: Date.now()
}

describe('POST /api/v1/accounts/password', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    changePassword: vi.fn(),
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockBcryptCompare.mockResolvedValue(true)
    mockBcryptHash.mockResolvedValue('new-password-hash')
    mockDb.changePassword.mockResolvedValue(undefined)
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([actor])
  })

  it('returns a bad request error for invalid JSON body', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/password',
      {
        method: 'POST',
        body: 'not-json',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Bad Request' })
  })

  it('returns 422 for body failing schema validation', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/password',
      {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: 'current-password',
          newPassword: 'short'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(422)
    expect(mockDb.changePassword).not.toHaveBeenCalled()
  })

  it('returns an internal server error when password change processing fails', async () => {
    mockDb.changePassword.mockRejectedValue(new Error('database failed'))

    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/password',
      {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: 'current-password',
          newPassword: 'new-password'
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Internal Server Error'
    })
    expect(mockDb.changePassword).toHaveBeenCalledWith({
      accountId: account.id,
      newPasswordHash: 'new-password-hash'
    })
  })
})
