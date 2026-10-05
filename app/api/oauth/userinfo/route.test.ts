import { NextRequest } from 'next/server'

import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'

// Drive the route handler directly with a controlled OAuth context so we can
// exercise the route-level fail-closed branch (account-less actor -> 401) that
// the getUserInfo unit tests cannot reach (getUserInfo now requires an account).
const guardState = vi.hoisted(() => ({
  currentActor: null as Actor | null,
  grantedScopes: undefined as string[] | undefined,
  // The Authorization header the guard was handed, so POST's form-body token
  // hand-off can be asserted without re-testing the guard itself.
  authorization: undefined as string | null | undefined
}))

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: { currentActor: Actor | null; grantedScopes?: string[] }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest) => {
      guardState.authorization = req.headers.get('authorization')
      return handle(req, {
        currentActor: guardState.currentActor,
        grantedScopes: guardState.grantedScopes
      })
    }
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'example.com', trustedHosts: [] })
}))

// Host resolution is unit-tested in lib/services/auth/requestOrigin.test.ts;
// here it only has to be deterministic so
// iss = 'https://example.com' + AUTH_BASE_PATH.
vi.mock('@/lib/services/auth/requestOrigin', () => ({
  resolveAuthBaseURL: () => 'https://example.com'
}))

const { GET, POST } = await import('./route')

const makeAccount = (overrides: Partial<Account> = {}): Account => {
  const now = Date.now()
  return {
    id: 'account-abc-123',
    email: 'test@example.com',
    // `email_verified` is built from `emailVerified`, not from the
    // default-filled `verifiedAt` this fixture used to rely on.
    emailVerified: true,
    emailVerifiedAt: now,
    twoFactorEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

const makeActor = (account: Account | null): Actor => ({
  id: 'https://example.com/users/testuser',
  username: 'testuser',
  domain: 'example.com',
  name: 'Test User',
  iconUrl: 'https://example.com/avatar.png',
  summary: 'A test user',
  followersUrl: 'https://example.com/users/testuser/followers',
  inboxUrl: 'https://example.com/users/testuser/inbox',
  sharedInboxUrl: 'https://example.com/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  publicKey: 'public-key',
  privateKey: 'private-key',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  account: account ?? undefined
})

const callGet = () =>
  GET(new NextRequest('https://example.com/oauth/userinfo'), {
    params: Promise.resolve({})
  })

describe('GET /oauth/userinfo', () => {
  beforeEach(() => {
    guardState.currentActor = null
    guardState.grantedScopes = undefined
    guardState.authorization = undefined
  })

  it('fails closed with 401 invalid_token when the actor has no account', async () => {
    guardState.currentActor = makeActor(null)
    guardState.grantedScopes = ['openid', 'profile', 'email']

    const response = await callGet()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_token' })
  })

  it('returns sub equal to the account id with profile and email claims', async () => {
    const account = makeAccount({ id: 'account-sub-xyz' })
    guardState.currentActor = makeActor(account)
    guardState.grantedScopes = ['openid', 'profile', 'email']

    const response = await callGet()
    const body = await response.json()

    expect(response.status).toBe(200)
    // OIDC §5.3.2: the userinfo sub is the account id (matches the id_token sub).
    expect(body.sub).toBe('account-sub-xyz')
    // Same value the discovery document advertises as `issuer`.
    expect(body.iss).toBe('https://example.com/api/auth')
    expect(body.preferred_username).toBe('testuser')
    expect(body.email).toBe('test@example.com')
    expect(body.email_verified).toBe(true)
  })

  it('returns only iss and sub for openid-only scope', async () => {
    const account = makeAccount({ id: 'account-openid-only' })
    guardState.currentActor = makeActor(account)
    guardState.grantedScopes = ['openid']

    const response = await callGet()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.sub).toBe('account-openid-only')
    expect(body.iss).toBe('https://example.com/api/auth')
    expect(body).not.toHaveProperty('preferred_username')
    expect(body).not.toHaveProperty('email')
  })
})

// POST is not the guard's handler itself: it moves an access token sent in the
// form body into the Authorization header, then delegates to the guarded GET
// handler. These pin that hand-off; the guard's own behaviour (401 without a
// token, scope checks) is covered in OAuthGuard.test.ts.
describe('POST /oauth/userinfo', () => {
  beforeEach(() => {
    guardState.currentActor = makeActor(makeAccount({ id: 'account-post' }))
    guardState.grantedScopes = ['openid']
    guardState.authorization = undefined
  })

  const callPost = (init: { headers?: HeadersInit; body?: string }) =>
    POST(
      new NextRequest('https://example.com/oauth/userinfo', {
        method: 'POST',
        ...init
      }),
      { params: Promise.resolve({}) }
    )

  it('hands a form-body access_token to the guard as a bearer token (OIDC Core 5.3.1)', async () => {
    const response = await callPost({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'access_token=form-token'
    })

    expect(guardState.authorization).toBe('Bearer form-token')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      sub: 'account-post'
    })
  })

  it('keeps an existing Authorization header and ignores a form-body token', async () => {
    await callPost({
      headers: {
        authorization: 'Bearer header-token',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: 'access_token=form-token'
    })

    expect(guardState.authorization).toBe('Bearer header-token')
  })

  it('passes a request with no token to the guard unchanged', async () => {
    await callPost({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'unrelated=1'
    })

    expect(guardState.authorization).toBeNull()
  })

  it('rejects an oversized unauthenticated form body with 413 before the guard runs', async () => {
    const response = await callPost({
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `access_token=${'a'.repeat(100 * 1024)}`
    })

    expect(response.status).toBe(413)
    expect(guardState.authorization).toBeUndefined()
  })
})
