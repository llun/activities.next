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

  it('returns email_verified true when verifiedAt is set', () => {
    const account = makeAccount({
      id: 'account-3',
      email: 'verified@example.com',
      emailVerifiedAt: null,
      verifiedAt: Date.now()
    })

    const userInfo = getUserInfo({
      actor: makeActor({ account }),
      account,
      issuer: ISSUER,
      scopes: ['openid', 'email']
    })

    expect(userInfo.email).toBe('verified@example.com')
    expect(userInfo.email_verified).toBe(true)
  })

  it('returns email_verified true when emailVerifiedAt is set', () => {
    const account = makeAccount({
      id: 'account-4',
      email: 'verified@example.com',
      emailVerifiedAt: Date.now(),
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

  it('returns email_verified false when neither verifiedAt nor emailVerifiedAt is set', () => {
    const account = makeAccount({
      id: 'account-2',
      email: 'unverified@example.com',
      emailVerifiedAt: null,
      verifiedAt: undefined
    })

    const userInfo = getUserInfo({
      actor: makeActor({ account }),
      account,
      issuer: ISSUER,
      scopes: ['openid', 'email']
    })

    expect(userInfo.email).toBe('unverified@example.com')
    expect(userInfo.email_verified).toBe(false)
  })
})
