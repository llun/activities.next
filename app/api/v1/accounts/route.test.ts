import { NextRequest } from 'next/server'

import { GET as verifyCredentials } from '@/app/api/v1/accounts/verify_credentials/route'
import { DEFAULT_SERVER_SETTINGS } from '@/lib/config/serverSettings'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { registerAccount } from '@/lib/services/accounts/registerAccount'
import {
  SERVED_DOMAIN_REFRESH_MS,
  refreshServedDomains,
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'
import { hashToken } from '@/lib/services/guards/OAuthGuard'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { Scope } from '@/lib/types/database/operations'
import { generatePublicId } from '@/lib/utils/publicId'

import { GET, MAX_BATCH_ACCOUNTS, POST } from './route'

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    registrationOpen: true,
    secretPhase: 'test-secret'
  })
}))

vi.mock('@/lib/services/accounts/registerAccount', () => ({
  registerAccount: vi.fn()
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn()
}))

// Registration open/closed is resolved from server settings.
const settingsWith = (open: boolean) => ({
  ...structuredClone(DEFAULT_SERVER_SETTINGS),
  registrations: { open, allowEmails: [] }
})

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null)
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

// Opaque tokens never reach better-auth's verifier, but the guard imports it.
vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

// getDatabase is read through a mutable binding so the hand-rolled mock
// (GET + web-form tests) and the real SQLite database (Bearer API tests) can
// each install themselves per describe block.
let mockDatabase: unknown = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

// run.example is a domain an admin added in Admin › Domains and turned on.
const runExampleRow = (signupsOpen: boolean) => ({
  id: 'run',
  domain: 'run.example',
  status: 'on' as const,
  name: null,
  signupsOpen,
  allowedEmails: [],
  allowExistingUsers: false,
  lastCheckedAt: null,
  lastCheckStatus: null,
  lastCheckResult: null,
  createdAt: 0,
  updatedAt: 0
})

const mastodonAccount = {
  id: 'account-id',
  username: 'alice',
  acct: 'alice',
  display_name: 'Alice'
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getResolvedServerSettings).mockResolvedValue(settingsWith(true))
})

describe('GET /api/v1/accounts', () => {
  const getActorIdsByPublicIds = vi.fn()

  beforeEach(() => {
    getActorIdsByPublicIds.mockResolvedValue(new Map<string, string>())
    mockDatabase = {
      getMastodonActorsFromIds: vi.fn().mockResolvedValue([mastodonAccount]),
      getActorIdsByPublicIds
    }
  })

  it('returns an empty array when no ids are provided', async () => {
    const req = new NextRequest('http://localhost/api/v1/accounts')
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
    expect(
      (mockDatabase as { getMastodonActorsFromIds: jest.Mock })
        .getMastodonActorsFromIds
    ).not.toHaveBeenCalled()
  })

  it('returns the requested accounts for id[] params and decodes the ids', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/accounts?id[]=abc&id[]=def'
    )
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([mastodonAccount])
    // Each encoded id is decoded via idToUrl before the DB lookup; a plain
    // (non-`apurl_`) value like `abc` decodes to `https://abc/`.
    expect(
      (mockDatabase as { getMastodonActorsFromIds: jest.Mock })
        .getMastodonActorsFromIds
    ).toHaveBeenCalledWith({
      ids: ['https://abc/', 'https://def/']
    })
  })

  it('also accepts plain id params', async () => {
    const req = new NextRequest('http://localhost/api/v1/accounts?id=abc')
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([mastodonAccount])
  })

  it('resolves a whole batch of publicIds with a single database lookup', async () => {
    const publicIds = Array.from({ length: 25 }, () => generatePublicId())
    const req = new NextRequest(
      `http://localhost/api/v1/accounts?${publicIds
        .map((publicId) => `id[]=${publicId}`)
        .join('&')}`
    )
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(getActorIdsByPublicIds).toHaveBeenCalledTimes(1)
    expect(getActorIdsByPublicIds).toHaveBeenCalledWith({ publicIds })
  })

  it('dedupes repeated ids so each one is only looked up once', async () => {
    const publicId = generatePublicId()
    const req = new NextRequest(
      `http://localhost/api/v1/accounts?id[]=${publicId}&id[]=${publicId}&id[]=${publicId}`
    )
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(getActorIdsByPublicIds).toHaveBeenCalledWith({
      publicIds: [publicId]
    })
    expect(
      (mockDatabase as { getMastodonActorsFromIds: jest.Mock })
        .getMastodonActorsFromIds
    ).toHaveBeenCalledWith({ ids: [publicId] })
  })

  it('truncates an over-cap id list to MAX_BATCH_ACCOUNTS instead of failing', async () => {
    const publicIds = Array.from({ length: MAX_BATCH_ACCOUNTS + 20 }, () =>
      generatePublicId()
    )
    const req = new NextRequest(
      `http://localhost/api/v1/accounts?${publicIds
        .map((publicId) => `id[]=${publicId}`)
        .join('&')}`
    )
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(getActorIdsByPublicIds).toHaveBeenCalledWith({
      publicIds: publicIds.slice(0, MAX_BATCH_ACCOUNTS)
    })
    expect(
      (
        (mockDatabase as { getMastodonActorsFromIds: jest.Mock })
          .getMastodonActorsFromIds.mock.calls[0][0] as { ids: string[] }
      ).ids
    ).toHaveLength(MAX_BATCH_ACCOUNTS)
  })
})

describe('POST /api/v1/accounts (web form / non-bearer)', () => {
  beforeEach(() => {
    mockDatabase = {
      getMastodonActorsFromIds: vi.fn().mockResolvedValue([mastodonAccount])
    }
  })

  it('declines JSON API clients with 501 and does not create an account', async () => {
    const createAccount = vi.fn()
    mockDatabase = { ...(mockDatabase as object), createAccount }
    const req = new NextRequest('http://localhost/api/v1/accounts', {
      method: 'POST',
      body: JSON.stringify({
        username: 'alice',
        email: 'alice@example.com',
        password: 'password123'
      }),
      headers: { 'Content-Type': 'application/json' }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(501)
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('declines form-encoded API clients (no text/html Accept) with 501', async () => {
    const createAccount = vi.fn()
    mockDatabase = { ...(mockDatabase as object), createAccount }
    const req = new NextRequest('http://localhost/api/v1/accounts', {
      method: 'POST',
      body: 'username=alice&email=alice@example.com&password=password123',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '*/*'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(501)
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('rejects web sign-up with 403 when registration is closed', async () => {
    vi.mocked(getResolvedServerSettings).mockResolvedValueOnce(
      settingsWith(false)
    )
    const createAccount = vi.fn()
    mockDatabase = { ...(mockDatabase as object), createAccount }
    const req = new NextRequest('http://localhost/api/v1/accounts', {
      method: 'POST',
      body: 'username=alice&email=alice@example.com&password=password123',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('returns 403 for closed registration even when the body is invalid', async () => {
    vi.mocked(getResolvedServerSettings).mockResolvedValueOnce(
      settingsWith(false)
    )
    const createAccount = vi.fn()
    mockDatabase = { ...(mockDatabase as object), createAccount }
    // Deliberately malformed/schema-invalid body — missing required fields.
    const req = new NextRequest('http://localhost/api/v1/accounts', {
      method: 'POST',
      body: 'not_a_valid_field=garbage',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    expect(createAccount).not.toHaveBeenCalled()
  })

  it('returns 422 with an accurate message when the email is not allowed', async () => {
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'email_not_allowed'
    })
    const req = new NextRequest('http://localhost/api/v1/accounts', {
      method: 'POST',
      body: 'username=alice&email=alice@example.com&password=password123',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(422)
    // The allow-list rejection must not be mislabeled as "already taken".
    expect(await res.json()).toEqual({
      error: 'Validation failed',
      details: {
        email: [
          {
            error: 'ERR_BLOCKED',
            description: 'Email is not allowed to register on this server'
          }
        ]
      }
    })
  })

  it('returns 422 with field details when registration validation fails', async () => {
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'validation_failed',
      details: {
        username: [
          { error: 'ERR_TAKEN', description: 'Username is already taken' }
        ]
      }
    })
    const req = new NextRequest('http://localhost/api/v1/accounts', {
      method: 'POST',
      body: 'username=alice&email=alice@example.com&password=password123',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'Validation failed',
      details: {
        username: [
          { error: 'ERR_TAKEN', description: 'Username is already taken' }
        ]
      }
    })
  })

  it('redirects to /auth/signin with 303 on successful registration', async () => {
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'success',
      accountId: 'new-account-id',
      username: 'alice',
      actorId: 'https://llun.test/users/alice'
    })
    const req = new NextRequest('http://localhost/api/v1/accounts', {
      method: 'POST',
      body: 'username=alice&email=alice@example.com&password=password123',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('/auth/signin')
  })

  const AGREEMENT_REQUIRED = {
    error: 'Validation failed: Agreement must be accepted',
    details: {
      agreement: [
        { error: 'ERR_ACCEPTED', description: 'Agreement must be accepted' }
      ]
    }
  }

  const postWebForm = (body: string) =>
    POST(
      new NextRequest('http://localhost/api/v1/accounts', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html'
        }
      }),
      { params: Promise.resolve({}) }
    )

  // Whether the agreement is needed depends on the domain's policies, which
  // registerAccount checks; the form only passes the checkbox through.
  it.each([
    { body: '', agreement: undefined },
    { body: '&agreement=true', agreement: true },
    { body: '&agreement=false', agreement: false }
  ])(
    'passes the agreement checkbox ($body) to registerAccount',
    async ({ body, agreement }) => {
      vi.mocked(registerAccount).mockResolvedValueOnce({
        type: 'success',
        accountId: 'new-account-id',
        username: 'alice',
        actorId: 'https://llun.test/users/alice'
      })
      const res = await postWebForm(
        `username=alice&email=alice@example.com&password=password123${body}`
      )
      expect(res.status).toBe(303)
      expect(vi.mocked(registerAccount).mock.calls[0][0].agreement).toBe(
        agreement
      )
    }
  )

  it('returns 422 ERR_ACCEPTED when the domain has policies and the box was not ticked', async () => {
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'agreement_required'
    })
    const res = await postWebForm(
      'username=alice&email=alice@example.com&password=password123'
    )
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual(AGREEMENT_REQUIRED)
  })

  it('lowercases the submitted email via the schema before registering', async () => {
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'success',
      accountId: 'new-account-id',
      username: 'alice',
      actorId: 'https://llun.test/users/alice'
    })
    const req = new NextRequest('http://localhost/api/v1/accounts', {
      method: 'POST',
      body: 'username=alice&email=Alice.Example@Example.COM&password=password123',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html'
      }
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(303)
    expect(registerAccount).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice.example@example.com' })
    )
  })
})

describe('POST /api/v1/accounts (web form) on an added domain', () => {
  const getServedDomain = vi.fn()

  beforeEach(() => {
    getServedDomain.mockReset()
    mockDatabase = { getServedDomain }
    setServedDomainsForTests(['run.example'])
  })

  afterEach(() => {
    vi.useRealTimers()
    resetServedDomainsForTests()
  })

  const postForm = () =>
    POST(
      new NextRequest('https://run.example/api/v1/accounts', {
        method: 'POST',
        body: 'username=alice&email=alice@example.com&password=password123',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'text/html',
          host: 'run.example'
        }
      }),
      { params: Promise.resolve({}) }
    )

  it('returns 403 when its sign-ups are closed, though the primary is open', async () => {
    getServedDomain.mockResolvedValue(runExampleRow(false))
    const res = await postForm()
    expect(res.status).toBe(403)
    expect(registerAccount).not.toHaveBeenCalled()
  })

  it('registers on that domain when its sign-ups are open', async () => {
    getServedDomain.mockResolvedValue(runExampleRow(true))
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'success',
      accountId: 'new-account-id',
      username: 'alice',
      actorId: 'https://run.example/users/alice'
    })
    const res = await postForm()
    expect(res.status).toBe(303)
    expect(registerAccount).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'run.example' })
    )
  })

  // A cold or thawed process holds a stale snapshot; reading the host from it
  // first would hand the sign-up to the (open) primary.
  it('refreshes a stale snapshot before deciding which domain the sign-up is on', async () => {
    resetServedDomainsForTests()
    // Loaded before the domain was turned on, so it does not list it.
    const getActiveServedDomains = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ domain: 'run.example' }])
    const database = { getServedDomain, getActiveServedDomains }
    mockDatabase = database
    await refreshServedDomains(database as unknown as Database)
    getServedDomain.mockResolvedValue(runExampleRow(false))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + SERVED_DOMAIN_REFRESH_MS + 1)

    const res = await postForm()
    expect(res.status).toBe(403)
    expect(registerAccount).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/accounts with a Bearer app token', () => {
  const DOMAIN = 'llun.test'
  const CLIENT_ID = 'register-api-client'
  const APP_TOKEN = 'app-token-value'
  const USER_TOKEN = 'user-token-value'
  const ACTORLESS_USER_TOKEN = 'actorless-user-token-value'
  const READ_ONLY_APP_TOKEN = 'read-only-app-token-value'
  const WRONG_WRITE_APP_TOKEN = 'wrong-write-app-token-value'
  const GRANULAR_WRITE_APP_TOKEN = 'granular-write-app-token-value'
  const NEW_USERNAME = 'newbie'
  const PENDING_USERNAME = 'pendingnewbie'
  const ACTORLESS_USERNAME = 'actorlessuser'

  const {
    database: apiDatabase,
    db: apiDb,
    destroy: destroyApiDatabase
  } = createTestDatabase({ backend: 'sqlite' })

  let accountId: string
  let actorId: string
  let pendingAccountId: string
  let pendingActorId: string
  let actorlessAccountId: string

  const insertToken = async ({
    token,
    referenceId,
    scopes = [Scope.enum.read, Scope.enum.write]
  }: {
    token: string
    referenceId: string | null
    scopes?: string[]
  }) => {
    await apiDb
      .insertInto('oauthAccessToken')
      .values({
        id: `token-${token}`,
        token: hashToken(token),
        clientId: CLIENT_ID,
        userId: referenceId ? accountId : null,
        referenceId,
        scopes: JSON.stringify(scopes),
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date()
      })
      .execute()
  }

  beforeAll(async () => {
    await apiDatabase.migrate()
    await apiDb
      .insertInto('oauthClient')
      .values({
        id: 'register-api-client-row',
        clientId: CLIENT_ID,
        name: 'Register API App',
        scopes: JSON.stringify([Scope.enum.read, Scope.enum.write]),
        redirectUris: JSON.stringify(['https://app.test/redirect']),
        requirePKCE: false,
        disabled: false,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .execute()
    accountId = await apiDatabase.createAccount({
      domain: DOMAIN,
      email: 'newbie@llun.test',
      username: NEW_USERNAME,
      name: 'New Bie',
      passwordHash: 'hashed-password',
      verificationCode: null,
      privateKey: 'private-key',
      publicKey: 'public-key'
    })
    const actor = await apiDatabase.getActorFromUsername({
      username: NEW_USERNAME,
      domain: DOMAIN
    })
    actorId = actor!.id

    // A second account whose confirmation e-mail has not been clicked yet.
    // registerAccount is mocked in this suite, so the pending state has to come
    // from a real row for the guard to read it back.
    pendingAccountId = await apiDatabase.createAccount({
      domain: DOMAIN,
      email: 'pending@llun.test',
      username: PENDING_USERNAME,
      passwordHash: 'hashed-password',
      verificationCode: 'pending-confirmation-code',
      privateKey: 'private-key',
      publicKey: 'public-key'
    })
    pendingActorId = `https://${DOMAIN}/users/${PENDING_USERNAME}`

    // An account that owns no selectable actor: every actor it has is pending
    // deletion, which is what makes `resolveAccountActorId` answer null.
    actorlessAccountId = await apiDatabase.createAccount({
      domain: DOMAIN,
      email: 'actorless@llun.test',
      username: ACTORLESS_USERNAME,
      passwordHash: 'hashed-password',
      verificationCode: null,
      privateKey: 'private-key',
      publicKey: 'public-key'
    })
    await apiDatabase.scheduleActorDeletion({
      actorId: `https://${DOMAIN}/users/${ACTORLESS_USERNAME}`,
      scheduledAt: new Date(Date.now() + 86_400_000)
    })

    // App (client_credentials) token: no bound actor.
    await insertToken({ token: APP_TOKEN, referenceId: null })
    // An app token without write:accounts (or its parent write).
    await insertToken({
      token: READ_ONLY_APP_TOKEN,
      referenceId: null,
      scopes: [Scope.enum.read]
    })
    // An app token with an unrelated write scope (neither write:accounts nor parent write).
    await insertToken({
      token: WRONG_WRITE_APP_TOKEN,
      referenceId: null,
      scopes: [Scope.enum['write:statuses']]
    })
    // An app token with only the granular write:accounts scope (no parent write).
    await insertToken({
      token: GRANULAR_WRITE_APP_TOKEN,
      referenceId: null,
      scopes: [Scope.enum['write:accounts']]
    })
    // User-bound token: delegates the newly created actor.
    await insertToken({ token: USER_TOKEN, referenceId: actorId })
    // A user-delegated token whose grant recorded no actor reference AND whose
    // account has no selectable actor. `OAuthAppGuard` leaves `currentActor`
    // null for it, which is indistinguishable from a genuine app token unless
    // the handler asks about the user.
    await apiDb
      .insertInto('oauthAccessToken')
      .values({
        id: `token-${ACTORLESS_USER_TOKEN}`,
        token: hashToken(ACTORLESS_USER_TOKEN),
        clientId: CLIENT_ID,
        userId: actorlessAccountId,
        referenceId: null,
        scopes: JSON.stringify([Scope.enum.read, Scope.enum.write]),
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date()
      })
      .execute()
  })

  afterAll(async () => {
    await destroyApiDatabase()
  })

  beforeEach(() => {
    mockDatabase = apiDatabase
  })

  const postRegister = (token: string, body: string) =>
    POST(
      new NextRequest('https://llun.test/api/v1/accounts', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${token}`
        }
      }),
      { params: Promise.resolve({}) }
    )

  it('registers an account and returns a usable user token', async () => {
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'success',
      accountId,
      username: NEW_USERNAME,
      actorId
    })

    const res = await postRegister(
      APP_TOKEN,
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=true`
    )

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({
      access_token: expect.any(String),
      token_type: 'Bearer',
      scope: 'read write',
      created_at: expect.any(Number)
    })

    // The returned token authenticates as the new user.
    const verify = await verifyCredentials(
      new NextRequest('https://llun.test/api/v1/accounts/verify_credentials', {
        headers: { Authorization: `Bearer ${data.access_token}` }
      }),
      { params: Promise.resolve({}) }
    )
    expect(verify.status).toBe(200)
  })

  const deepHasKey = (value: unknown, key: string): boolean => {
    if (!value || typeof value !== 'object') return false
    if (key in (value as Record<string, unknown>)) return true
    return Object.values(value as Record<string, unknown>).some((v) =>
      deepHasKey(v, key)
    )
  }

  const takenUsername: Awaited<ReturnType<typeof registerAccount>> = {
    type: 'validation_failed',
    details: {
      username: [
        { error: 'ERR_TAKEN', description: 'Username is already taken' }
      ]
    }
  }

  it.each([
    {
      description: 'missing agreement',
      body: `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123`,
      registerResult: undefined,
      detailKey: 'agreement'
    },
    {
      description: 'invalid email',
      body: `username=${NEW_USERNAME}&email=not-an-email&password=password123&agreement=true`,
      registerResult: undefined,
      detailKey: 'email'
    },
    {
      description: 'taken username',
      body: `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=true`,
      registerResult: takenUsername,
      detailKey: 'username'
    }
  ])(
    'returns 422 for $description',
    async ({ body, registerResult, detailKey }) => {
      if (registerResult) {
        vi.mocked(registerAccount).mockResolvedValueOnce(registerResult)
      }
      const res = await postRegister(APP_TOKEN, body)
      expect(res.status).toBe(422)
      const data = await res.json()
      expect(deepHasKey(data.details, detailKey)).toBe(true)
    }
  )

  // Mastodon requires the agreement on every API registration, policies or
  // not, so the route refuses before registerAccount and always tells it the
  // agreement was accepted.
  it('requires the agreement even when the domain has no policies', async () => {
    const res = await postRegister(
      APP_TOKEN,
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=false`
    )
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: 'Validation failed: Agreement must be accepted',
      details: {
        agreement: [
          { error: 'ERR_ACCEPTED', description: 'Agreement must be accepted' }
        ]
      }
    })
    expect(registerAccount).not.toHaveBeenCalled()
  })

  it('tells registerAccount the agreement was accepted', async () => {
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'success',
      accountId,
      username: NEW_USERNAME,
      actorId
    })
    const res = await postRegister(
      APP_TOKEN,
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=1`
    )
    expect(res.status).toBe(200)
    expect(registerAccount).toHaveBeenCalledWith(
      expect.objectContaining({ agreement: true })
    )
  })

  it('returns 403 when registration is closed', async () => {
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'registration_closed'
    })
    const res = await postRegister(
      APP_TOKEN,
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=true`
    )
    expect(res.status).toBe(403)
  })

  it('returns 403 when the email is not allowed to register', async () => {
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'email_not_allowed'
    })
    const res = await postRegister(
      APP_TOKEN,
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=true`
    )
    expect(res.status).toBe(403)
  })

  it('returns 403 for closed registration before parsing the body', async () => {
    vi.mocked(getResolvedServerSettings).mockResolvedValueOnce(
      settingsWith(false)
    )
    // Malformed body (missing required fields): a closed server must still
    // answer 403 without reaching schema validation or registerAccount().
    const res = await postRegister(APP_TOKEN, 'garbage=1')
    expect(res.status).toBe(403)
    expect(registerAccount).not.toHaveBeenCalled()
  })

  it('returns 401 for an unknown bearer token', async () => {
    const res = await postRegister(
      'totally-unknown-token',
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=true`
    )
    expect(res.status).toBe(401)
  })

  // Registration builds its OAuthAppGuard inside POST's own code, so
  // routeScopeWiring.test.ts cannot see its scope; this pins it.
  it('returns 401 for an app token without write:accounts', async () => {
    const res = await postRegister(
      READ_ONLY_APP_TOKEN,
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=true`
    )
    expect(res.status).toBe(401)
    expect(vi.mocked(registerAccount)).not.toHaveBeenCalled()
  })

  it('returns 401 for an app token with an unrelated write scope', async () => {
    const res = await postRegister(
      WRONG_WRITE_APP_TOKEN,
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=true`
    )
    expect(res.status).toBe(401)
    expect(vi.mocked(registerAccount)).not.toHaveBeenCalled()
  })

  it('allows registration with an app token having only granular write:accounts scope', async () => {
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'success',
      accountId,
      username: NEW_USERNAME,
      actorId
    })
    const res = await postRegister(
      GRANULAR_WRITE_APP_TOKEN,
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=true`
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.scope).toBe('write:accounts')
    expect(registerAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        username: NEW_USERNAME,
        email: 'newbie@llun.test'
      })
    )
  })

  it('returns 403 for a user-bound (non-app) token', async () => {
    const res = await postRegister(
      USER_TOKEN,
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=true`
    )
    expect(res.status).toBe(403)
  })

  it('returns 403 for a user token whose account has no selectable actor', async () => {
    // The app-token gate used to read `currentActor`, which OAuthAppGuard also
    // leaves null when it merely FAILS to resolve an actor — so a delegated
    // user token whose grant recorded no reference and whose actors are all
    // pending deletion was accepted as an app token and could mint accounts.
    const res = await postRegister(
      ACTORLESS_USER_TOKEN,
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=true`
    )
    expect(res.status).toBe(403)
    expect(registerAccount).not.toHaveBeenCalled()
  })

  it('issues a token that is refused until the new account confirms its e-mail', async () => {
    // Mastodon returns the token here and 403s every user-requiring call until
    // the address is confirmed; the token must not be a working credential for
    // an address nobody has proven they control.
    vi.mocked(registerAccount).mockResolvedValueOnce({
      type: 'success',
      accountId: pendingAccountId,
      username: PENDING_USERNAME,
      actorId: pendingActorId
    })

    const res = await postRegister(
      APP_TOKEN,
      `username=${PENDING_USERNAME}&email=pending@llun.test&password=password123&agreement=true`
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.access_token).toEqual(expect.any(String))

    const verify = await verifyCredentials(
      new NextRequest('https://llun.test/api/v1/accounts/verify_credentials', {
        headers: { Authorization: `Bearer ${data.access_token}` }
      }),
      { params: Promise.resolve({}) }
    )
    expect(verify.status).toBe(403)
  })

  describe('on a domain added in Admin › Domains', () => {
    const body = `username=runner&email=runner@llun.test&password=password123&agreement=true`
    const postOnRunExample = () =>
      POST(
        new NextRequest('https://run.example/api/v1/accounts', {
          method: 'POST',
          body,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Bearer ${APP_TOKEN}`,
            host: 'run.example'
          }
        }),
        { params: Promise.resolve({}) }
      )

    afterEach(async () => {
      vi.useRealTimers()
      resetServedDomainsForTests()
      await apiDatabase.deleteServedDomain({ domain: 'run.example' })
    })

    it('returns 403 when its sign-ups are closed, though the primary is open', async () => {
      await apiDatabase.createServedDomain({
        domain: 'run.example',
        status: 'on',
        signupsOpen: false
      })
      setServedDomainsForTests(['run.example'])
      const res = await postOnRunExample()
      expect(res.status).toBe(403)
      expect(registerAccount).not.toHaveBeenCalled()
    })

    it('registers on that domain when its sign-ups are open', async () => {
      await apiDatabase.createServedDomain({
        domain: 'run.example',
        status: 'on',
        signupsOpen: true
      })
      setServedDomainsForTests(['run.example'])
      vi.mocked(registerAccount).mockResolvedValueOnce({
        type: 'success',
        accountId,
        username: NEW_USERNAME,
        actorId
      })
      const res = await postOnRunExample()
      expect(res.status).toBe(200)
      expect(registerAccount).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'run.example' })
      )
    })

    // A cold or thawed process holds a stale snapshot; reading the host from
    // it first would hand the sign-up to the (open) primary.
    it('refreshes a stale snapshot before deciding which domain the sign-up is on', async () => {
      // Loaded before the domain was turned on, so it does not list it.
      await refreshServedDomains(apiDatabase)
      await apiDatabase.createServedDomain({
        domain: 'run.example',
        status: 'on',
        signupsOpen: false
      })
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + SERVED_DOMAIN_REFRESH_MS + 1)
      const res = await postOnRunExample()
      expect(res.status).toBe(403)
      expect(registerAccount).not.toHaveBeenCalled()
    })
  })
})
