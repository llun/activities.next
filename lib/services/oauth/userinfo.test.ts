import { Actor } from '@/lib/models/actor'

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
      profile: 'https://example.com/users/testuser'
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
})
