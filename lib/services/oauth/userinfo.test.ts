import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'

import { getUserInfo } from './userinfo'

const makeActor = (overrides: Partial<Actor> = {}): Actor => ({
  id: 'https://example.com/users/testuser',
  username: 'testuser',
  domain: 'example.com',
  name: 'Test User',
  iconUrl: 'https://example.com/avatar.png',
  headerImageUrl: undefined,
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
  account: undefined,
  ...overrides
})

const makeAccount = (overrides: Partial<Account> = {}): Account => {
  const now = Date.now()
  return {
    // Better Auth account ids are short nanoids, deliberately unlike the
    // actor's URL id so the `sub = account.id` assertions are meaningful.
    id: 'lfpCbM75O9OcBmxgq9JI',
    email: 'test@example.com',
    twoFactorEnabled: false,
    // The claim is built from `emailVerified`; `emailVerifiedAt` is kept on the
    // fixture because other assertions read the account shape, not because it
    // decides this.
    emailVerified: true,
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

// The same `${baseURL}${AUTH_BASE_PATH}` value the discovery document
// advertises; the route passes it in per request.
const ISSUER = 'https://example.com/api/auth'

describe('getUserInfo', () => {
  it('returns sub, profile and email claims when no scopes are specified (legacy/session)', () => {
    const account = makeAccount({ id: 'account-1' })
    const userInfo = getUserInfo({
      actor: makeActor(),
      account,
      issuer: ISSUER
    })

    expect(userInfo.sub).toBe('account-1')
    expect(userInfo.name).toBe('Test User')
    expect(userInfo.preferred_username).toBe('testuser')
    expect(userInfo.picture).toBe('https://example.com/avatar.png')
    expect(userInfo.profile).toBe('https://example.com/users/testuser')
    expect(userInfo.email).toBe('test@example.com')
    expect(userInfo.email_verified).toBe(true)
  })

  it('includes profile claims when read scope is granted', () => {
    const userInfo = getUserInfo({
      actor: makeActor(),
      account: makeAccount(),
      issuer: ISSUER,
      scopes: ['read']
    })

    expect(userInfo.name).toBe('Test User')
    expect(userInfo.preferred_username).toBe('testuser')
  })

  it('returns empty-string name and picture when the actor has none', () => {
    const userInfo = getUserInfo({
      actor: makeActor({ name: undefined, iconUrl: undefined }),
      account: makeAccount(),
      issuer: ISSUER,
      scopes: ['openid', 'profile']
    })

    // Mastodon always returns these claims from /oauth/userinfo; empty
    // string, not omission.
    expect(userInfo.name).toBe('')
    expect(userInfo.picture).toBe('')
    expect(userInfo.preferred_username).toBe('testuser')
    expect(userInfo.profile).toBe('https://example.com/users/testuser')
  })

  it('reports email_verified false for an account whose only signal is verifiedAt', () => {
    // This test asserted `true` until the claim moved off `verifiedAt`.
    // `accounts.verifiedAt` carries DEFAULT CURRENT_TIMESTAMP, so it is
    // non-null for every account ever written and proves nothing — reading it
    // here asserted a verified address to every OIDC relying party for accounts
    // that had never confirmed one. It is the same defect that made
    // `canCreateSessionForAccount`'s check a no-op for as long as that helper
    // has existed, and this was
    // the last surface still trusting it.
    const account = makeAccount({
      id: 'account-3',
      email: 'defaulted@example.com',
      emailVerified: false,
      emailVerifiedAt: null,
      verifiedAt: Date.now()
    })

    const userInfo = getUserInfo({
      actor: makeActor({ account }),
      account,
      issuer: ISSUER,
      scopes: ['openid', 'email']
    })

    expect(userInfo.email).toBe('defaulted@example.com')
    expect(userInfo.email_verified).toBe(false)
  })

  it('reports email_verified false once a re-point clears the flag', () => {
    // The shape `repointUnconfirmedAccountEmail` leaves behind. A
    // backfilled-cohort account that moves its address must not carry its old
    // verification to the new one.
    const account = makeAccount({
      id: 'account-5',
      email: 'repointed@example.com',
      emailVerified: false,
      emailVerifiedAt: null,
      verifiedAt: null
    })

    const userInfo = getUserInfo({
      actor: makeActor({ account }),
      account,
      issuer: ISSUER,
      scopes: ['openid', 'email']
    })

    expect(userInfo.email).toBe('repointed@example.com')
    expect(userInfo.email_verified).toBe(false)
  })
})
