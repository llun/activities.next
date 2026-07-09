import { NextRequest } from 'next/server'

import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'

// Drive the route handler directly with a controlled OAuth context so we can
// exercise the route-level fail-closed branch (account-less actor -> 401) that
// the getUserInfo unit tests cannot reach (getUserInfo now requires an account).
const guardState = vi.hoisted(() => ({
  currentActor: null as Actor | null,
  grantedScopes: undefined as string[] | undefined
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
    (req: NextRequest) =>
      handle(req, {
        currentActor: guardState.currentActor,
        grantedScopes: guardState.grantedScopes
      })
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

const { GET } = await import('./route')

const makeAccount = (overrides: Partial<Account> = {}): Account => {
  const now = Date.now()
  return {
    id: 'account-abc-123',
    email: 'test@example.com',
    emailVerifiedAt: now,
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
  headerImageUrl: null,
  summary: 'A test user',
  followersUrl: 'https://example.com/users/testuser/followers',
  inboxUrl: 'https://example.com/users/testuser/inbox',
  sharedInboxUrl: 'https://example.com/inbox',
  publicKey: 'public-key',
  privateKey: 'private-key',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...(account ? { account } : { account: null })
})

const callGet = () =>
  GET(new NextRequest('https://example.com/oauth/userinfo'), {
    params: Promise.resolve({})
  })

describe('GET /oauth/userinfo', () => {
  beforeEach(() => {
    guardState.currentActor = null
    guardState.grantedScopes = undefined
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
