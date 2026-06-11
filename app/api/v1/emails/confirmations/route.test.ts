import knex from 'knex'
import { NextRequest } from 'next/server'

import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { hashToken } from '@/lib/services/guards/OAuthGuard'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { Scope } from '@/lib/types/database/operations'

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
  | 'isAccountExists'
>

let mockDatabase: unknown = null
let mockKnex: unknown = undefined
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => mockKnex
}))

jest.mock('better-auth/oauth2', () => ({ verifyAccessToken: jest.fn() }))

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
    requestEmailChange: jest.fn(),
    isAccountExists: jest.fn()
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
    mockDb.isAccountExists.mockResolvedValue(false)
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

  it('returns 403 when the new email is not on the server allow-list', async () => {
    // The signed-in address stays on the allow-list (so auth still resolves the
    // actor); only the requested new address is absent from it.
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [seedActor1.email],
      allowActorDomains: [],
      email: { serviceFromAddress: 'noreply@llun.test' }
    })

    const response = await POST(makeRequest({ email: 'blocked@llun.test' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Email is not allowed on this server'
    })
    expect(mockDb.updateAccountEmail).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('returns 422 when the new email is already registered to another account', async () => {
    mockDb.isAccountExists.mockResolvedValue(true)

    const response = await POST(makeRequest({ email: 'taken@llun.test' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Email is already taken'
    })
    expect(mockDb.isAccountExists).toHaveBeenCalledWith({
      email: 'taken@llun.test'
    })
    expect(mockDb.updateAccountEmail).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('honors a form-encoded email param like the registration endpoint', async () => {
    const request = new NextRequest(
      'http://llun.test/api/v1/emails/confirmations',
      {
        method: 'POST',
        body: 'email=form-email@llun.test',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://llun.test'
        }
      }
    )

    const response = await POST(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mockDb.updateAccountEmail).toHaveBeenCalledWith({
      accountId: 'account-1',
      email: 'form-email@llun.test'
    })
    const [mailArgs] = mockSendMail.mock.calls
    expect(mailArgs[0].to).toEqual(['form-email@llun.test'])
  })

  it('returns 422 when a concurrent claim races onto the unique-email constraint', async () => {
    // Pre-check passes (the racing request committed after it), so the
    // collision only surfaces when updateAccountEmail hits the DB constraint.
    mockDb.updateAccountEmail.mockRejectedValueOnce(
      Object.assign(new Error('UNIQUE constraint failed: accounts.email'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE'
      })
    )

    const response = await POST(makeRequest({ email: 'raced@llun.test' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Email is already taken'
    })
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('returns 422 with field details when the email param is invalid', async () => {
    const response = await POST(makeRequest({ email: 'not-an-email' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(422)
    const data = await response.json()
    expect(data.error).toBe('Validation failed')
    expect(data.details.email).toBeDefined()
    expect(mockDb.updateAccountEmail).not.toHaveBeenCalled()
    expect(mockDb.requestEmailChange).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('resends to the existing address when no email param is provided', async () => {
    const response = await POST(makeRequest({ other: 'field' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(mockDb.updateAccountEmail).not.toHaveBeenCalled()
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

// Exercises the route's documented primary path: a freshly-registered client
// presenting the Bearer access token from POST /api/v1/accounts (OAuthGuard),
// rather than the cookie-session fallback used by the cases above.
describe('POST /api/v1/emails/confirmations with a Bearer token', () => {
  const DOMAIN = 'llun.test'
  const CLIENT_ID = 'confirmations-client'
  const USER_TOKEN = 'user-token-value'
  const USERNAME = 'pendingbie'

  const apiKnex = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const apiDatabase: Database = getSQLDatabase(apiKnex)

  const bearerRequest = (token: string) =>
    new NextRequest('https://llun.test/api/v1/emails/confirmations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    })

  beforeAll(async () => {
    await apiDatabase.migrate()
    await apiKnex('oauthClient').insert({
      id: 'confirmations-client-row',
      clientId: CLIENT_ID,
      name: 'Confirmations App',
      scopes: JSON.stringify([Scope.enum.read, Scope.enum.write]),
      redirectUris: JSON.stringify(['https://app.test/redirect']),
      requirePKCE: false,
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date()
    })
    const accountId = await apiDatabase.createAccount({
      domain: DOMAIN,
      email: 'pendingbie@llun.test',
      username: USERNAME,
      name: 'Pending Bie',
      passwordHash: 'hashed-password',
      // Still awaiting confirmation, so the resend is allowed.
      verificationCode: PENDING_CODE,
      privateKey: 'private-key',
      publicKey: 'public-key'
    })
    const actor = await apiDatabase.getActorFromUsername({
      username: USERNAME,
      domain: DOMAIN
    })
    await apiKnex('oauthAccessToken').insert({
      id: 'confirmations-token-row',
      token: hashToken(USER_TOKEN),
      clientId: CLIENT_ID,
      userId: accountId,
      referenceId: actor!.id,
      scopes: JSON.stringify([Scope.enum.read, Scope.enum.write]),
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date()
    })
  })

  afterAll(async () => {
    await apiKnex.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockDatabase = apiDatabase
    mockKnex = apiKnex
    mockGetConfig.mockReturnValue({
      host: DOMAIN,
      allowEmails: [],
      allowActorDomains: [],
      email: { serviceFromAddress: 'noreply@llun.test' }
    })
    mockSendMail.mockResolvedValue(undefined)
  })

  it('resolves the actor from a valid Bearer token and resends the email', async () => {
    const response = await POST(bearerRequest(USER_TOKEN), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({})
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    const [mailArgs] = mockSendMail.mock.calls
    expect(mailArgs[0].to).toEqual(['pendingbie@llun.test'])
  })

  it('returns 401 for an unknown Bearer token', async () => {
    const response = await POST(bearerRequest('totally-unknown-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})
