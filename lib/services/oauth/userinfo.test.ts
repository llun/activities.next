import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'

import { getUserInfo } from './userinfo'

describe('#getUserInfo', () => {
  it('returns correct OpenID Connect userinfo format', () => {
    const actor: Actor = {
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
      account: null
    }

    const userInfo = getUserInfo(actor)

    expect(userInfo).toMatchObject({
      sub: expect.toBeString(),
      name: 'Test User',
      preferred_username: 'testuser',
      picture: 'https://example.com/avatar.png',
      profile: 'https://example.com/users/testuser',
      email: null,
      email_verified: false
    })
  })

  it('handles actor without name', () => {
    const actor: Actor = {
      id: 'https://example.com/users/noname',
      username: 'noname',
      domain: 'example.com',
      name: null,
      iconUrl: null,
      headerImageUrl: null,
      summary: null,
      followersUrl: 'https://example.com/users/noname/followers',
      inboxUrl: 'https://example.com/users/noname/inbox',
      sharedInboxUrl: 'https://example.com/inbox',
      publicKey: 'public-key',
      privateKey: 'private-key',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      account: null
    }

    const userInfo = getUserInfo(actor)

    expect(userInfo.name).toBeNull()
    expect(userInfo.preferred_username).toBe('noname')
    expect(userInfo.picture).toBeNull()
    expect(userInfo.email).toBeNull()
    expect(userInfo.email_verified).toBe(false)
  })

  it('encodes actor ID as sub claim', () => {
    const actor: Actor = {
      id: 'https://example.com/users/encoded',
      username: 'encoded',
      domain: 'example.com',
      name: 'Encoded User',
      iconUrl: null,
      headerImageUrl: null,
      summary: null,
      followersUrl: 'https://example.com/users/encoded/followers',
      inboxUrl: 'https://example.com/users/encoded/inbox',
      sharedInboxUrl: 'https://example.com/inbox',
      publicKey: 'public-key',
      privateKey: 'private-key',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      account: null
    }

    const userInfo = getUserInfo(actor)

    // sub should be URL-encoded ID
    expect(userInfo.sub).toBeTruthy()
    expect(typeof userInfo.sub).toBe('string')
  })

  it('includes email and email_verified when account is provided', () => {
    const now = Date.now()
    const account: Account = {
      id: 'account-1',
      email: 'test@example.com',
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now
    }
    const actor: Actor = {
      id: 'https://example.com/users/testuser',
      username: 'testuser',
      domain: 'example.com',
      name: 'Test User',
      iconUrl: null,
      headerImageUrl: null,
      summary: null,
      followersUrl: 'https://example.com/users/testuser/followers',
      inboxUrl: 'https://example.com/users/testuser/inbox',
      sharedInboxUrl: 'https://example.com/inbox',
      publicKey: 'public-key',
      privateKey: 'private-key',
      createdAt: now,
      updatedAt: now,
      account
    }

    const userInfo = getUserInfo(actor, account)

    expect(userInfo.email).toBe('test@example.com')
    expect(userInfo.email_verified).toBe(true)
  })

  it('returns email_verified false when emailVerifiedAt is null', () => {
    const now = Date.now()
    const account: Account = {
      id: 'account-2',
      email: 'unverified@example.com',
      emailVerifiedAt: null,
      createdAt: now,
      updatedAt: now
    }
    const actor: Actor = {
      id: 'https://example.com/users/unverified',
      username: 'unverified',
      domain: 'example.com',
      name: 'Unverified User',
      iconUrl: null,
      headerImageUrl: null,
      summary: null,
      followersUrl: 'https://example.com/users/unverified/followers',
      inboxUrl: 'https://example.com/users/unverified/inbox',
      sharedInboxUrl: 'https://example.com/inbox',
      publicKey: 'public-key',
      privateKey: 'private-key',
      createdAt: now,
      updatedAt: now,
      account
    }

    const userInfo = getUserInfo(actor, account)

    expect(userInfo.email).toBe('unverified@example.com')
    expect(userInfo.email_verified).toBe(false)
  })
})
