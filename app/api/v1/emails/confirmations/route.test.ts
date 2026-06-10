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

const mockGetConfig = jest.fn()
jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: () => mockGetConfig()
}))

type MockDatabase = Pick<
  Database,
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'updateAccountEmail'
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

const PENDING_CODE = 'pending-verification-code'

const buildAccount = (verificationCode: string | null) => ({
  id: 'account-1',
  email: seedActor1.email,
  verificationCode,
  defaultActorId: ACTOR1_ID,
  createdAt: Date.now(),
  updatedAt: Date.now()
})

const buildActor = (account: ReturnType<typeof buildAccount>) => ({
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
})

const makeRequest = (body?: unknown) =>
  new NextRequest('http://llun.test/api/v1/emails/confirmations', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://llun.test'
    }
  })

describe('POST /api/v1/emails/confirmations', () => {
  const mockDb: jest.Mocked<MockDatabase> = {
    getAccountFromEmail: jest.fn(),
    getActorsForAccount: jest.fn(),
    updateAccountEmail: jest.fn(),
    requestEmailChange: jest.fn()
  }

  const setAccount = (account: ReturnType<typeof buildAccount>) => {
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([buildActor(account)])
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: [],
      email: {
        serviceFromAddress: 'noreply@llun.test'
      }
    })
    mockSendMail.mockResolvedValue(undefined)
    mockDb.updateAccountEmail.mockResolvedValue(undefined)
    mockDb.requestEmailChange.mockResolvedValue(undefined)
    setAccount(buildAccount(PENDING_CODE))
  })

  it('resends the confirmation email and returns 200 for an account awaiting confirmation', async () => {
    const response = await POST(makeRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})

    expect(mockSendMail).toHaveBeenCalledTimes(1)
    const [mailArgs] = mockSendMail.mock.calls
    expect(mailArgs[0].to).toEqual([seedActor1.email])
    expect(mailArgs[0].content.text).toContain(
      `https://llun.test/auth/confirmation?verificationCode=${PENDING_CODE}`
    )
    expect(mockDb.requestEmailChange).not.toHaveBeenCalled()
  })

  it('returns 403 when the account has already confirmed its email', async () => {
    setAccount(buildAccount(null))

    const response = await POST(makeRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error:
        'This method is only available while the e-mail is awaiting confirmation'
    })
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('returns 403 when the verification code is an empty string', async () => {
    setAccount(buildAccount(''))

    const response = await POST(makeRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(403)
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('updates the account email directly and confirms the new address when an email param is provided', async () => {
    const response = await POST(makeRequest({ email: 'new-email@llun.test' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})

    expect(mockDb.updateAccountEmail).toHaveBeenCalledTimes(1)
    expect(mockDb.updateAccountEmail).toHaveBeenCalledWith({
      accountId: 'account-1',
      email: 'new-email@llun.test'
    })
    expect(mockDb.requestEmailChange).not.toHaveBeenCalled()

    expect(mockSendMail).toHaveBeenCalledTimes(1)
    const [mailArgs] = mockSendMail.mock.calls
    expect(mailArgs[0].to).toEqual(['new-email@llun.test'])
    // The resent link must carry the existing verificationCode so clicking it
    // confirms the NEW address rather than stranding it.
    expect(mailArgs[0].content.text).toContain(
      `https://llun.test/auth/confirmation?verificationCode=${PENDING_CODE}`
    )
    expect(mailArgs[0].content.html).toContain(
      `https://llun.test/auth/confirmation?verificationCode=${PENDING_CODE}`
    )
  })

  it('ignores an invalid email param and resends to the existing address', async () => {
    const response = await POST(makeRequest({ email: 'not-an-email' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(mockDb.updateAccountEmail).not.toHaveBeenCalled()
    expect(mockDb.requestEmailChange).not.toHaveBeenCalled()
    const [mailArgs] = mockSendMail.mock.calls
    expect(mailArgs[0].to).toEqual([seedActor1.email])
  })

  it('returns 500 when sending the confirmation email fails', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP failure'))

    const response = await POST(makeRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(500)
    expect(mockSendMail).toHaveBeenCalledTimes(1)
  })

  it('returns 200 without sending mail when email is not configured', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: [],
      email: undefined
    })

    const response = await POST(makeRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})
