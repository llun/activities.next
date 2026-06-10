import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: []
  })
}))

type MockDatabase = Pick<
  Database,
  'getAccountFromEmail' | 'getActorsForAccount' | 'verifyEmailChange'
>

let mockDatabase: MockDatabase | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: () => undefined
  })
}))

const account = {
  id: 'account-1',
  email: seedActor1.email,
  defaultActorId: ACTOR1_ID,
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

describe('POST /api/v1/accounts/email/verify', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: jest.fn(),
    getActorsForAccount: jest.fn(),
    verifyEmailChange: jest.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([actor])
    mockDb.verifyEmailChange.mockResolvedValue(account)
  })

  it.each([
    ['invalid JSON', 'not-json'],
    ['empty JSON body', '']
  ])('returns 400 for %s', async (_name, body) => {
    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/email/verify',
      {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(mockDb.verifyEmailChange).not.toHaveBeenCalled()
  })

  it('returns an internal server error when email verification processing fails', async () => {
    mockDb.verifyEmailChange.mockRejectedValue(new Error('database failed'))

    const request = new NextRequest(
      'http://llun.test/api/v1/accounts/email/verify',
      {
        method: 'POST',
        body: JSON.stringify({ emailChangeCode: 'verification-code' }),
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      status: 'Internal Server Error'
    })
  })
})
