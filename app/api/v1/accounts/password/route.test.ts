import { NextRequest } from 'next/server'

import { createInMemoryRateLimitDatabase } from '@/lib/database/testing/inMemoryRateLimit'
import { Database } from '@/lib/database/types'
import {
  PASSWORD_CHANGE_LIMIT,
  resetRouteRateLimitsForTests
} from '@/lib/services/auth/routeRateLimits'
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
  | 'changePassword'
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'consumeRateLimit'
  | 'deleteRateLimits'
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
  twoFactorEnabled: false,
  emailVerified: true,
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
  const mockDb: jest.Mocked<
    Omit<MockDatabase, 'consumeRateLimit' | 'deleteRateLimits'>
  > &
    ReturnType<typeof createInMemoryRateLimitDatabase> = {
    ...createInMemoryRateLimitDatabase(),
    changePassword: vi.fn(),
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetRouteRateLimitsForTests()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockBcryptCompare.mockResolvedValue(true)
    mockBcryptHash.mockResolvedValue('new-password-hash')
    mockDb.changePassword.mockResolvedValue(true)
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([actor])
  })

  it('answers 429 past 10 password changes per account while another account passes', async () => {
    expect(PASSWORD_CHANGE_LIMIT).toBe(10)
    const call = () =>
      POST(
        new NextRequest('http://llun.test/api/v1/accounts/password', {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: 'old-password',
            newPassword: 'new-password-123'
          }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }),
        { params: Promise.resolve({}) }
      )

    for (let i = 0; i < PASSWORD_CHANGE_LIMIT; i += 1) {
      expect((await call()).status).toBe(200)
    }

    const limited = await call()
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: 'Too many requests' })
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(mockBcryptCompare).toHaveBeenCalledTimes(PASSWORD_CHANGE_LIMIT)

    const otherAccount = { ...account, id: 'account-2' }
    mockDb.getAccountFromEmail.mockResolvedValue(otherAccount)
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...actor, account: otherAccount }
    ])
    expect((await call()).status).toBe(200)
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
      newPasswordHash: 'new-password-hash',
      expectedPasswordHash: 'password-hash',
      // Omitted in the body: signing connected apps out is the default.
      signOutApps: true
    })
  })

  it('passes signOutApps: false through when the owner keeps their apps', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/password',
      {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: 'current-password',
          newPassword: 'new-password',
          signOutApps: false
        }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDb.changePassword).toHaveBeenCalledWith({
      accountId: account.id,
      newPasswordHash: 'new-password-hash',
      expectedPasswordHash: 'password-hash',
      signOutApps: false
    })
  })

  it('returns 422 when signOutApps is not a boolean', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/password',
      {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: 'current-password',
          newPassword: 'new-password',
          signOutApps: 'yes'
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

  it('returns 409 when the password changed mid-request', async () => {
    // The write is a compare-and-swap on the verified hash: a reset that
    // landed in between makes it match nothing.
    mockDb.changePassword.mockResolvedValue(false)

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

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error:
        'Your password changed while this request was in progress. Please try again.'
    })
  })

  it('returns 403 when actor is suspended', async () => {
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...actor, suspendedAt: Date.now() }
    ])

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

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockDb.changePassword).not.toHaveBeenCalled()
  })

  it('returns 403 when account is disabled', async () => {
    mockDb.getActorsForAccount.mockResolvedValue([
      { ...actor, account: { ...account, disabledAt: Date.now() } }
    ])

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

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockDb.changePassword).not.toHaveBeenCalled()
  })

  it('returns 403 when account confirmation is pending', async () => {
    mockDb.getActorsForAccount.mockResolvedValue([
      {
        ...actor,
        account: {
          ...account,
          verificationCode: 'pending-code',
          twoFactorEnabled: false,
          emailVerified: false
        }
      }
    ])

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

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
    expect(mockDb.changePassword).not.toHaveBeenCalled()
  })
})
