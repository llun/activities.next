import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'

import { getUserInfo } from './userinfo'

const makeActor = (overrides: Partial<Actor> = {}): Actor => ({
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
  account: null,
  ...overrides
})

const makeAccount = (overrides: Partial<Account> = {}): Account => {
  const now = Date.now()
  return {
    // Better Auth account ids are short nanoids, deliberately unlike the
    // actor's URL id so the `sub = account.id` assertions are meaningful.
    id: 'lfpCbM75O9OcBmxgq9JI',
    email: 'test@example.com',
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
  it('includes iss matching the discovery issuer', () => {
    const userInfo = getUserInfo({
      actor: makeActor(),
      account: makeAccount(),
      issuer: ISSUER,
      scopes: ['openid']
    })

    expect(userInfo.iss).toBe(ISSUER)
  })

  it('uses the account id as the sub claim, not the actor id', () => {
    const account = makeAccount({ id: 'account-sub-123' })
    const userInfo = getUserInfo({
      actor: makeActor(),
      account,
      issuer: ISSUER
    })

    // OIDC §5.3.2: the userinfo sub MUST match the id_token sub. Better Auth
    // signs the id_token with the account (user) id, so the canonical subject
    // here is the account id — never the actor URL id.
    expect(userInfo.sub).toBe('account-sub-123')
    expect(userInfo.sub).not.toBe(makeActor().id)
  })

  it('returns a sub equal to the id_token sub (account id) for the same session', () => {
    const account = makeAccount({ id: 'shared-subject-id' })

    // Better Auth resolves the id_token `sub` via resolveSubjectIdentifier,
    // which (with subject_types_supported: ['public'], no pairwise secret)
    // returns user.id — the Better Auth account id. Mirror that here so the
    // assertion documents the cross-endpoint invariant.
    const idTokenSub = account.id

    const userInfo = getUserInfo({
      actor: makeActor(),
      account,
      issuer: ISSUER,
      scopes: ['openid']
    })

    expect(userInfo.sub).toBe(idTokenSub)
  })

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

  it('returns only iss and sub for openid-only scope', () => {
    const account = makeAccount({ id: 'account-1' })
    const userInfo = getUserInfo({
      actor: makeActor(),
      account,
      issuer: ISSUER,
      scopes: ['openid']
    })

    expect(userInfo).toEqual({ iss: ISSUER, sub: 'account-1' })
  })

  it('includes profile claims when profile scope is granted', () => {
    const account = makeAccount()
    const userInfo = getUserInfo({
      actor: makeActor(),
      account,
      issuer: ISSUER,
      scopes: ['openid', 'profile']
    })

    expect(userInfo.sub).toBe(account.id)
    expect(userInfo.name).toBe('Test User')
    expect(userInfo.preferred_username).toBe('testuser')
    expect(userInfo.picture).toBe('https://example.com/avatar.png')
    expect(userInfo.profile).toBe('https://example.com/users/testuser')
    expect(userInfo).not.toHaveProperty('email')
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
      actor: makeActor({ name: null, iconUrl: null }),
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

  it('includes email claims when email scope is granted', () => {
    const account = makeAccount({
      id: 'account-1',
      email: 'test@example.com',
      emailVerified: true,
      emailVerifiedAt: Date.now()
    })

    const userInfo = getUserInfo({
      actor: makeActor({ account }),
      account,
      issuer: ISSUER,
      scopes: ['openid', 'email']
    })

    expect(userInfo.email).toBe('test@example.com')
    expect(userInfo.email_verified).toBe(true)
    expect(userInfo).not.toHaveProperty('name')
  })

  it('omits email claims when email scope is not granted', () => {
    const account = makeAccount({
      id: 'account-1',
      email: 'test@example.com',
      emailVerifiedAt: Date.now()
    })

    const userInfo = getUserInfo({
      actor: makeActor({ account }),
      account,
      issuer: ISSUER,
      scopes: ['openid', 'profile']
    })

    expect(userInfo).not.toHaveProperty('email')
    expect(userInfo).not.toHaveProperty('email_verified')
  })

  it('reports email_verified false for an account whose only signal is verifiedAt', () => {
    // This test asserted `true` until the claim moved off `verifiedAt`.
    // `accounts.verifiedAt` carries DEFAULT CURRENT_TIMESTAMP, so it is
    // non-null for every account ever written and proves nothing — reading it
    // here asserted a verified address to every OIDC relying party for accounts
    // that had never confirmed one. It is the same defect that made
    // `canCreateSessionForAccount`'s check a no-op for two years, and this was
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

  it('reports email_verified from emailVerified, agreeing with the id_token', () => {
    // `lib/services/auth/auth.ts` builds the id_token's claim from
    // `emailVerified`, and better-auth's own userinfo resolves the same column.
    // One fact, one column, three surfaces.
    const account = makeAccount({
      id: 'account-4',
      email: 'verified@example.com',
      emailVerified: true,
      emailVerifiedAt: null,
      verifiedAt: undefined
    })

    const userInfo = getUserInfo({
      actor: makeActor({ account }),
      account,
      issuer: ISSUER,
      scopes: ['openid', 'email']
    })

    expect(userInfo.email_verified).toBe(true)
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
