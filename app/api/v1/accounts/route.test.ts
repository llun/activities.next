import knex from 'knex'
import { NextRequest } from 'next/server'

import { GET as verifyCredentials } from '@/app/api/v1/accounts/verify_credentials/route'
import { getConfig } from '@/lib/config'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'
import { registerAccount } from '@/lib/services/accounts/registerAccount'
import { hashToken } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'

import { GET, POST } from './route'

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

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue(null)
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

// Opaque tokens never reach better-auth's verifier, but the guard imports it.
vi.mock('better-auth/oauth2', () => ({ verifyAccessToken: vi.fn() }))

// getDatabase/getKnex are read through mutable bindings so the hand-rolled mock
// (GET + web-form tests) and the real SQLite database (Bearer API tests) can
// each install themselves per describe block.
let mockDatabase: unknown = null
let mockKnex: unknown = undefined
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => mockKnex
}))

const mastodonAccount = {
  id: 'account-id',
  username: 'alice',
  acct: 'alice',
  display_name: 'Alice'
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/accounts', () => {
  beforeEach(() => {
    mockKnex = undefined
    mockDatabase = {
      getMastodonActorsFromIds: vi.fn().mockResolvedValue([mastodonAccount])
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
})

describe('POST /api/v1/accounts (web form / non-bearer)', () => {
  beforeEach(() => {
    mockKnex = undefined
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
    vi.mocked(getConfig).mockReturnValueOnce({
      host: 'llun.test',
      allowEmails: [],
      registrationOpen: false
    } as never)
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
    vi.mocked(getConfig).mockReturnValueOnce({
      host: 'llun.test',
      allowEmails: [],
      registrationOpen: false
    } as never)
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

  it('redirects to /auth/signin with 307 on successful registration', async () => {
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
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/auth/signin')
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
    expect(res.status).toBe(307)
    expect(registerAccount).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice.example@example.com' })
    )
  })
})

describe('POST /api/v1/accounts with a Bearer app token', () => {
  const DOMAIN = 'llun.test'
  const CLIENT_ID = 'register-api-client'
  const APP_TOKEN = 'app-token-value'
  const USER_TOKEN = 'user-token-value'
  const NEW_USERNAME = 'newbie'

  const apiKnex = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const apiDatabase: Database = getSQLDatabase(apiKnex)

  let accountId: string
  let actorId: string

  const insertToken = async ({
    token,
    referenceId
  }: {
    token: string
    referenceId: string | null
  }) => {
    await apiKnex('oauthAccessToken').insert({
      id: `token-${token}`,
      token: hashToken(token),
      clientId: CLIENT_ID,
      userId: referenceId ? accountId : null,
      referenceId,
      scopes: JSON.stringify([Scope.enum.read, Scope.enum.write]),
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date()
    })
  }

  beforeAll(async () => {
    await apiDatabase.migrate()
    await apiKnex('oauthClient').insert({
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

    // App (client_credentials) token: no bound actor.
    await insertToken({ token: APP_TOKEN, referenceId: null })
    // User-bound token: delegates the newly created actor.
    await insertToken({ token: USER_TOKEN, referenceId: actorId })
  })

  afterAll(async () => {
    await apiKnex.destroy()
  })

  beforeEach(() => {
    mockDatabase = apiDatabase
    mockKnex = apiKnex
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
    vi.mocked(getConfig).mockReturnValueOnce({
      host: 'llun.test',
      allowEmails: [],
      registrationOpen: false,
      secretPhase: 'test-secret'
    } as never)
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

  it('returns 403 for a user-bound (non-app) token', async () => {
    const res = await postRegister(
      USER_TOKEN,
      `username=${NEW_USERNAME}&email=newbie@llun.test&password=password123&agreement=true`
    )
    expect(res.status).toBe(403)
  })
})
