import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockSendMail = jest.fn()
jest.mock('@/lib/services/email', () => ({
  sendMail: (...args: unknown[]) => mockSendMail(...args)
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    allowActorDomains: [],
    email: {
      serviceFromAddress: 'noreply@llun.test'
    }
  })
}))

type MockDatabase = Pick<
  Database,
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'getActorFromId'
  | 'requestEmailChange'
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

describe('POST /api/v1/accounts/email', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: jest.fn(),
    getActorsForAccount: jest.fn(),
    getActorFromId: jest.fn(),
    requestEmailChange: jest.fn()
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockSendMail.mockResolvedValue(undefined)
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([actor])
    mockDb.getActorFromId.mockResolvedValue(actor)
    mockDb.requestEmailChange.mockResolvedValue(undefined)
  })

  it('returns 400 for invalid JSON body', async () => {
    const request = new NextRequest('http://llun.test/api/v1/accounts/email', {
      method: 'POST',
      body: 'not-json',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://llun.test'
      }
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    expect(mockDb.requestEmailChange).not.toHaveBeenCalled()
  })

  it('returns an internal server error when email change processing fails', async () => {
    mockDb.requestEmailChange.mockRejectedValue(new Error('database failed'))

    const request = new NextRequest('http://llun.test/api/v1/accounts/email', {
      method: 'POST',
      body: JSON.stringify({ newEmail: 'new-email@llun.test' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://llun.test'
      }
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      status: 'Internal Server Error'
    })
    expect(mockDb.requestEmailChange).toHaveBeenCalled()
  })

  it('returns 422 for body failing schema validation', async () => {
    const request = new NextRequest('http://llun.test/api/v1/accounts/email', {
      method: 'POST',
      body: JSON.stringify({ newEmail: 'not-an-email' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://llun.test'
      }
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(422)
    expect(mockDb.requestEmailChange).not.toHaveBeenCalled()
  })

  it('normalizes the requested new email to lowercase before storing it', async () => {
    const request = new NextRequest('http://llun.test/api/v1/accounts/email', {
      method: 'POST',
      body: JSON.stringify({ newEmail: 'New.Address@LLUN.test' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://llun.test'
      }
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDb.requestEmailChange).toHaveBeenCalledWith(
      expect.objectContaining({ newEmail: 'new.address@llun.test' })
    )
  })

  it('rejects changing to a differently-cased address owned by another account', async () => {
    // The session resolves to account-1; the requested new address (once
    // normalized) already belongs to account-2, so the change is rejected.
    mockDb.getAccountFromEmail.mockImplementation(
      async ({ email }: { email: string }) =>
        email.toLowerCase() === seedActor1.email.toLowerCase()
          ? account
          : { ...account, id: 'account-2', email: email.toLowerCase() }
    )

    const request = new NextRequest('http://llun.test/api/v1/accounts/email', {
      method: 'POST',
      body: JSON.stringify({ newEmail: 'Taken@LLUN.test' }),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://llun.test'
      }
    })

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Email already in use'
    })
    expect(mockDb.getAccountFromEmail).toHaveBeenCalledWith({
      email: 'taken@llun.test'
    })
    expect(mockDb.requestEmailChange).not.toHaveBeenCalled()
  })
})
