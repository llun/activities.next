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

describe('#getUserInfo', () => {
  it('returns all claims when no scopes specified (legacy/session)', () => {
    const userInfo = getUserInfo({ actor: makeActor() })

    expect(userInfo.sub).toBeString()
    expect(userInfo.name).toBe('Test User')
    expect(userInfo.preferred_username).toBe('testuser')
    expect(userInfo.picture).toBe('https://example.com/avatar.png')
    expect(userInfo.profile).toBe('https://example.com/users/testuser')
    // No account provided, so email claims are omitted
    expect(userInfo).not.toHaveProperty('email')
    expect(userInfo).not.toHaveProperty('email_verified')
  })

  it('returns only sub for openid-only scope', () => {
    const userInfo = getUserInfo({
      actor: makeActor(),
      scopes: ['openid']
    })

    expect(userInfo.sub).toBeTruthy()
    expect(userInfo).not.toHaveProperty('name')
    expect(userInfo).not.toHaveProperty('preferred_username')
    expect(userInfo).not.toHaveProperty('email')
    expect(userInfo).not.toHaveProperty('email_verified')
  })

  it('includes profile claims when profile scope is granted', () => {
    const userInfo = getUserInfo({
      actor: makeActor(),
      scopes: ['openid', 'profile']
    })

    expect(userInfo.sub).toBeTruthy()
    expect(userInfo.name).toBe('Test User')
    expect(userInfo.preferred_username).toBe('testuser')
    expect(userInfo.picture).toBe('https://example.com/avatar.png')
    expect(userInfo.profile).toBe('https://example.com/users/testuser')
    expect(userInfo).not.toHaveProperty('email')
  })

  it('includes profile claims when read scope is granted', () => {
    const userInfo = getUserInfo({
      actor: makeActor(),
      scopes: ['read']
    })

    expect(userInfo.name).toBe('Test User')
    expect(userInfo.preferred_username).toBe('testuser')
  })

  it('omits name and picture when actor has null values', () => {
    const userInfo = getUserInfo({
      actor: makeActor({ name: null, iconUrl: null }),
      scopes: ['openid', 'profile']
    })

    expect(userInfo).not.toHaveProperty('name')
    expect(userInfo.preferred_username).toBe('testuser')
    expect(userInfo).not.toHaveProperty('picture')
    expect(userInfo.profile).toBe('https://example.com/users/testuser')
  })

  it('includes email claims when email scope is granted', () => {
    const now = Date.now()
    const account: Account = {
      id: 'account-1',
      email: 'test@example.com',
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now
    }

    const userInfo = getUserInfo({
      actor: makeActor({ account }),
      account,
      scopes: ['openid', 'email']
    })

    expect(userInfo.email).toBe('test@example.com')
    expect(userInfo.email_verified).toBe(true)
    expect(userInfo).not.toHaveProperty('name')
  })

  it('omits email claims when email scope is not granted', () => {
    const now = Date.now()
    const account: Account = {
      id: 'account-1',
      email: 'test@example.com',
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now
    }

    const userInfo = getUserInfo({
      actor: makeActor({ account }),
      account,
      scopes: ['openid', 'profile']
    })

    expect(userInfo).not.toHaveProperty('email')
    expect(userInfo).not.toHaveProperty('email_verified')
  })

  it('omits email claims when account has no email', () => {
    const userInfo = getUserInfo({
      actor: makeActor(),
      scopes: ['openid', 'email']
    })

    expect(userInfo).not.toHaveProperty('email')
    expect(userInfo).not.toHaveProperty('email_verified')
  })

  it('returns email_verified true when verifiedAt is set', () => {
    const now = Date.now()
    const account: Account = {
      id: 'account-3',
      email: 'verified@example.com',
      emailVerifiedAt: null,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now
    }

    const userInfo = getUserInfo({
      actor: makeActor({ account }),
      account,
      scopes: ['openid', 'email']
    })

    expect(userInfo.email).toBe('verified@example.com')
    expect(userInfo.email_verified).toBe(true)
  })

  it('returns email_verified false when neither verifiedAt nor emailVerifiedAt is set', () => {
    const now = Date.now()
    const account: Account = {
      id: 'account-2',
      email: 'unverified@example.com',
      emailVerifiedAt: null,
      createdAt: now,
      updatedAt: now
    }

    const userInfo = getUserInfo({
      actor: makeActor({ account }),
      account,
      scopes: ['openid', 'email']
    })

    expect(userInfo.email).toBe('unverified@example.com')
    expect(userInfo.email_verified).toBe(false)
  })

  it('encodes actor ID as sub claim', () => {
    const userInfo = getUserInfo({ actor: makeActor() })

    expect(userInfo.sub).toBeTruthy()
    expect(typeof userInfo.sub).toBe('string')
  })
})
