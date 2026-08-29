import knex from 'knex'
import { NextRequest } from 'next/server'

import { DEFAULT_SERVER_SETTINGS } from '@/lib/config/serverSettings'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { hashToken } from '@/lib/services/guards/OAuthGuard'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { Scope } from '@/lib/types/database/operations'

import { POST } from './route'

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn()
}))

// The email allow-list is resolved from server settings.
const settingsWithAllowEmails = (allowEmails: string[]) => ({
  ...structuredClone(DEFAULT_SERVER_SETTINGS),
  registrations: { open: true, allowEmails }
})

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockSendMail = vi.fn()
vi.mock('@/lib/services/email', () => ({
  sendMail: (...args: unknown[]) => mockSendMail(...args)
}))

const mockGetConfig = vi.fn()
vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: () => mockGetConfig()
}))

type MockDatabase = Pick<
  Database,
  | 'getAccountFromEmail'
  | 'getActorsForAccount'
  | 'repointUnconfirmedAccountEmail'
  | 'requestEmailChange'
  | 'isAccountExists'
>

let mockDatabase: unknown = null
let mockKnex: unknown = undefined
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => mockKnex
}))

vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

const PENDING_CODE = 'pending-verification-code'

const buildAccount = (
  verificationCode: string | null,
  emailVerified = false
) => ({
  id: 'account-1',
  email: seedActor1.email,
  verificationCode,
  emailVerified,
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
    getAccountFromEmail: vi.fn(),
    getActorsForAccount: vi.fn(),
    repointUnconfirmedAccountEmail: vi.fn(),
    requestEmailChange: vi.fn(),
    isAccountExists: vi.fn()
  }

  const setAccount = (account: ReturnType<typeof buildAccount>) => {
    mockDb.getAccountFromEmail.mockResolvedValue(account)
    mockDb.getActorsForAccount.mockResolvedValue([buildActor(account)])
  }

  beforeAll(() => {
    mockDatabase = mockDb
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getResolvedServerSettings).mockResolvedValue(
      settingsWithAllowEmails([])
    )
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
    mockDb.repointUnconfirmedAccountEmail.mockImplementation(
      async ({ accountId, email, verificationCode }) => ({
        ...buildAccount(verificationCode, false),
        id: accountId,
        email
      })
    )
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

  it('rotates the verification code when the address is re-pointed', async () => {
    // `verifyAccount` matches on the code alone, with no binding to the address
    // it was mailed to. Carrying the old code across a re-point therefore lets
    // whoever received it confirm an address they do not control: register with
    // your own, re-point to someone else's, click the link you already have.
    // The account ends up confirmed — and asserted `email_verified: true` over
    // OIDC — for an address nobody proved they hold.
    const response = await POST(makeRequest({ email: 'new-email@llun.test' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)

    expect(mockDb.repointUnconfirmedAccountEmail).toHaveBeenCalledTimes(1)
    const [updateArgs] = mockDb.repointUnconfirmedAccountEmail.mock.calls
    expect(updateArgs[0].email).toBe('new-email@llun.test')
    const rotated = updateArgs[0].verificationCode
    expect(rotated).toEqual(expect.any(String))
    expect(rotated).not.toBe(PENDING_CODE)
    expect(rotated).toHaveLength(43)

    // The address change and the code that confirms it are one write, so no
    // window exists in which the row holds the new address and the old code.
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    const [mailArgs] = mockSendMail.mock.calls
    expect(mailArgs[0].to).toEqual(['new-email@llun.test'])
    expect(mailArgs[0].content.text).toContain(
      `https://llun.test/auth/confirmation?verificationCode=${rotated}`
    )
    // The superseded code must not travel with it.
    expect(mailArgs[0].content.text).not.toContain(PENDING_CODE)
  })

  it('does not rotate the code on a plain resend to the same address', async () => {
    // Rotation is gated on the address actually changing, matching the write.
    // Rotating here would mail a code the row does not hold, so every resend
    // would deliver a dead link.
    const response = await POST(makeRequest({ email: seedActor1.email }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(mockDb.repointUnconfirmedAccountEmail).not.toHaveBeenCalled()
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    const [mailArgs] = mockSendMail.mock.calls
    expect(mailArgs[0].content.text).toContain(
      `https://llun.test/auth/confirmation?verificationCode=${PENDING_CODE}`
    )
  })

  it('returns 403 for a backfilled-cohort account, which every other surface treats as confirmed', async () => {
    // `20260320072514_better_auth_columns` marked this cohort verified while
    // their code stayed set, and `20260828140000` skips on an instance where
    // that backfill ran in the same pass — a pre-March restore, a staging copy,
    // a catch-up — so the state is permanent there.
    //
    // This route used to gate on the raw `verificationCode`, so it alone read
    // such an account as awaiting confirmation while the guards,
    // `canCreateSessionForAccount`, the admin `confirmed` field and the OIDC
    // claim all read it as confirmed. It is bearer-reachable with `write`,
    // and the flow that actually PROVES an address is cookie-only — so a
    // Mastodon client token could re-point a confirmed account's e-mail to one
    // it controls and take the account over through password reset.
    setAccount(buildAccount(PENDING_CODE, true))

    const response = await POST(makeRequest({ email: 'attacker@llun.test' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(403)
    expect(mockDb.repointUnconfirmedAccountEmail).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
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

    expect(mockDb.repointUnconfirmedAccountEmail).toHaveBeenCalledTimes(1)
    expect(mockDb.repointUnconfirmedAccountEmail).toHaveBeenCalledWith({
      accountId: 'account-1',
      email: 'new-email@llun.test',
      verificationCode: expect.any(String)
    })
    expect(mockDb.requestEmailChange).not.toHaveBeenCalled()

    const rotated =
      mockDb.repointUnconfirmedAccountEmail.mock.calls[0][0].verificationCode

    expect(mockSendMail).toHaveBeenCalledTimes(1)
    const [mailArgs] = mockSendMail.mock.calls
    expect(mailArgs[0].to).toEqual(['new-email@llun.test'])
    // The resent link carries the code stored alongside the NEW address, so
    // clicking it confirms that address rather than stranding it. It is a
    // FRESH code: the previous one proved control of the previous address
    // only, and `verifyAccount` matches on the code with no binding to the
    // address it was mailed to.
    expect(mailArgs[0].content.text).toContain(
      `https://llun.test/auth/confirmation?verificationCode=${rotated}`
    )
    expect(mailArgs[0].content.html).toContain(
      `https://llun.test/auth/confirmation?verificationCode=${rotated}`
    )
    expect(mailArgs[0].content.text).not.toContain(PENDING_CODE)
  })

  it('normalizes a mixed-case new email param to lowercase before updating', async () => {
    const response = await POST(
      makeRequest({ email: '  New-Email@LLUN.test ' }),
      {
        params: Promise.resolve({})
      }
    )

    expect(response.status).toBe(200)
    expect(mockDb.isAccountExists).toHaveBeenCalledWith({
      email: 'new-email@llun.test'
    })
    expect(mockDb.repointUnconfirmedAccountEmail).toHaveBeenCalledWith({
      accountId: 'account-1',
      email: 'new-email@llun.test',
      verificationCode: expect.any(String)
    })
    const [mailArgs] = mockSendMail.mock.calls
    expect(mailArgs[0].to).toEqual(['new-email@llun.test'])
  })

  it('allows a new email whose case differs from the allow-list entry', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowActorDomains: [],
      email: { serviceFromAddress: 'noreply@llun.test' }
    })
    vi.mocked(getResolvedServerSettings).mockResolvedValue(
      settingsWithAllowEmails([seedActor1.email, 'Allowed@LLUN.test'])
    )

    const response = await POST(makeRequest({ email: 'allowed@llun.test' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(mockDb.repointUnconfirmedAccountEmail).toHaveBeenCalledWith({
      accountId: 'account-1',
      email: 'allowed@llun.test',
      verificationCode: expect.any(String)
    })
  })

  it('returns 403 when the new email is not on the server allow-list', async () => {
    // The signed-in address stays on the allow-list (so auth still resolves the
    // actor); only the requested new address is absent from it.
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowActorDomains: [],
      email: { serviceFromAddress: 'noreply@llun.test' }
    })
    vi.mocked(getResolvedServerSettings).mockResolvedValue(
      settingsWithAllowEmails([seedActor1.email])
    )

    const response = await POST(makeRequest({ email: 'blocked@llun.test' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Email is not allowed on this server'
    })
    expect(mockDb.repointUnconfirmedAccountEmail).not.toHaveBeenCalled()
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
    expect(mockDb.repointUnconfirmedAccountEmail).not.toHaveBeenCalled()
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
    expect(mockDb.repointUnconfirmedAccountEmail).toHaveBeenCalledWith({
      accountId: 'account-1',
      email: 'form-email@llun.test',
      verificationCode: expect.any(String)
    })
    const [mailArgs] = mockSendMail.mock.calls
    expect(mailArgs[0].to).toEqual(['form-email@llun.test'])
  })

  it('returns 422 when a concurrent claim races onto the unique-email constraint', async () => {
    // Pre-check passes (the racing request committed after it), so the
    // collision only surfaces when repointUnconfirmedAccountEmail hits the DB constraint.
    mockDb.repointUnconfirmedAccountEmail.mockRejectedValueOnce(
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
    expect(mockDb.repointUnconfirmedAccountEmail).not.toHaveBeenCalled()
    expect(mockDb.requestEmailChange).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('resends to the existing address when no email param is provided', async () => {
    const response = await POST(makeRequest({ other: 'field' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(mockDb.repointUnconfirmedAccountEmail).not.toHaveBeenCalled()
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

  it('returns 403 when repointing an account that is no longer pending confirmation', async () => {
    mockDb.repointUnconfirmedAccountEmail.mockResolvedValue(
      buildAccount(null, true)
    )

    const response = await POST(makeRequest({ email: 'new-email@llun.test' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error:
        'This method is only available while the e-mail is awaiting confirmation'
    })
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('returns 404 when repointing an account that does not exist in the database', async () => {
    mockDb.repointUnconfirmedAccountEmail.mockResolvedValue(null)

    const response = await POST(makeRequest({ email: 'new-email@llun.test' }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Account not found'
    })
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

  const bearerRequest = (token: string, body?: unknown) =>
    new NextRequest('https://llun.test/api/v1/emails/confirmations', {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      }
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
    vi.clearAllMocks()
    vi.mocked(getResolvedServerSettings).mockResolvedValue(
      settingsWithAllowEmails([])
    )
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

  it('refuses to repoint and returns 403 when confirmation lands between guard read and database write', async () => {
    const RACE_USERNAME = 'racepending'
    const RACE_USER_TOKEN = 'race-user-token-value'
    const raceAccountId = await apiDatabase.createAccount({
      domain: DOMAIN,
      email: 'racepending@llun.test',
      username: RACE_USERNAME,
      name: 'Race Pending',
      passwordHash: 'hashed-password',
      verificationCode: 'race-pending-code',
      privateKey: 'private-key-race',
      publicKey: 'public-key-race'
    })
    const raceActor = await apiDatabase.getActorFromUsername({
      username: RACE_USERNAME,
      domain: DOMAIN
    })
    await apiKnex('oauthAccessToken').insert({
      id: 'race-token-row',
      token: hashToken(RACE_USER_TOKEN),
      clientId: CLIENT_ID,
      userId: raceAccountId,
      referenceId: raceActor!.id,
      scopes: JSON.stringify([Scope.enum.read, Scope.enum.write]),
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date()
    })

    // Intercept during route execution (after guard reads the pending account)
    // to simulate a concurrent confirmation landing before the UPDATE statement.
    const origIsAccountExists = apiDatabase.isAccountExists.bind(apiDatabase)
    vi.spyOn(apiDatabase, 'isAccountExists').mockImplementation(
      async (params) => {
        await apiDatabase.verifyAccount({
          verificationCode: 'race-pending-code'
        })
        return origIsAccountExists(params)
      }
    )

    const response = await POST(
      bearerRequest(RACE_USER_TOKEN, { email: 'hijacked@llun.test' }),
      {
        params: Promise.resolve({})
      }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error:
        'This method is only available while the e-mail is awaiting confirmation'
    })
    expect(mockSendMail).not.toHaveBeenCalled()

    // The database row must NOT have been overwritten by the race.
    const accountInDb = await apiDatabase.getAccountFromId({
      id: raceAccountId
    })
    expect(accountInDb?.email).toBe('racepending@llun.test')
    expect(accountInDb?.emailVerified).toBeTrue()
    expect(accountInDb?.verificationCode).toBe('')
  })
})
