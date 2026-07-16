import { NextRequest } from 'next/server'

import { resetRefreshRemoteActorStateForTesting } from '@/lib/services/actors/refreshRemoteActor'

import { GET } from './route'

const mockGetActorFromUsername = vi.fn()
const mockGetActorFromId = vi.fn()
const mockGetMastodonActorFromId = vi.fn()
const mockGetWebfingerSelf = vi.fn()
const mockRecordActorIfNeeded = vi.fn()
const mockGetServerSession = vi.fn()
const mockStoredToken = vi.fn()
const oauthActor = {
  id: 'https://llun.test/users/oauth-user',
  username: 'oauth-user',
  domain: 'llun.test',
  followersUrl: 'https://llun.test/users/oauth-user/followers',
  inboxUrl: 'https://llun.test/users/oauth-user/inbox',
  sharedInboxUrl: 'https://llun.test/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1,
  publicKey: 'public-key',
  updatedAt: 1
}

vi.mock('@/lib/database', () => ({
  getDatabase: () => ({
    getActorFromUsername: mockGetActorFromUsername,
    getActorFromId: mockGetActorFromId,
    getMastodonActorFromId: mockGetMastodonActorFromId
  }),
  getKnex: () => () => ({
    where: () => ({
      first: () => mockStoredToken()
    })
  })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://llun.test',
  getConfig: () => ({ host: 'llun.test' })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/activities/getWebfingerSelf', () => ({
  getWebfingerSelf: (...args: unknown[]) => mockGetWebfingerSelf(...args)
}))

vi.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: (...args: unknown[]) => mockRecordActorIfNeeded(...args)
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

describe('GET /api/v1/accounts/lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRefreshRemoteActorStateForTesting()
    mockGetServerSession.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue(null)
  })

  it('uses the normalized username for @user local lookup', async () => {
    const actor = { id: 'https://llun.test/users/test1' }
    const account = { id: 'test1', username: 'test1', acct: 'test1' }
    mockGetActorFromUsername.mockResolvedValue(actor)
    mockGetMastodonActorFromId.mockResolvedValue(account)

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/accounts/lookup?acct=@test1')
    )

    expect(response.status).toBe(200)
    expect(mockGetActorFromUsername).toHaveBeenCalledWith({
      username: 'test1',
      domain: 'llun.test'
    })
  })

  it('rejects handles with more than one username/domain separator', async () => {
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=user@host@domain'
      )
    )

    expect(response.status).toBe(400)
    expect(mockGetWebfingerSelf).not.toHaveBeenCalled()
  })

  it('does not remotely resolve unauthenticated lookup requests', async () => {
    mockGetActorFromUsername.mockResolvedValue(null)
    mockGetWebfingerSelf.mockResolvedValue('https://remote.test/users/person')
    mockRecordActorIfNeeded.mockResolvedValue({
      id: 'https://remote.test/users/person'
    })

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=person@remote.test&resolve=true'
      )
    )

    expect(response.status).toBe(404)
    expect(mockGetWebfingerSelf).not.toHaveBeenCalled()
  })

  it('allows bearer tokens with read scope to remotely resolve accounts', async () => {
    const actor = { id: 'https://remote.test/users/person' }
    const account = {
      id: 'person',
      username: 'person',
      acct: 'person@remote.test'
    }
    mockGetActorFromUsername.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: 'https://llun.test/users/oauth-user',
      scopes: 'read'
    })
    mockGetActorFromId.mockResolvedValue(oauthActor)
    mockGetWebfingerSelf.mockResolvedValue('https://remote.test/users/person')
    mockRecordActorIfNeeded.mockResolvedValue(actor)
    mockGetMastodonActorFromId.mockResolvedValue(account)

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=person@remote.test&resolve=true',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      )
    )

    expect(response.status).toBe(200)
    expect(mockGetWebfingerSelf).toHaveBeenCalledWith({
      account: 'person@remote.test'
    })
    expect(mockGetServerSession).not.toHaveBeenCalled()
    expect(await response.json()).toEqual(account)
  })

  it('allows bearer tokens with read:accounts scope to remotely resolve accounts', async () => {
    const actor = { id: 'https://remote.test/users/person' }
    const account = {
      id: 'person',
      username: 'person',
      acct: 'person@remote.test'
    }
    mockGetActorFromUsername.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: 'https://llun.test/users/oauth-user',
      scopes: 'read:accounts'
    })
    mockGetActorFromId.mockResolvedValue(oauthActor)
    mockGetWebfingerSelf.mockResolvedValue('https://remote.test/users/person')
    mockRecordActorIfNeeded.mockResolvedValue(actor)
    mockGetMastodonActorFromId.mockResolvedValue(account)

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=person@remote.test&resolve=true',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(account)
  })

  it('refreshes a known remote actor for session viewers before serialization', async () => {
    const storedActor = {
      id: 'https://remote.test/users/person',
      account: null,
      privateKey: ''
    }
    const refreshedActor = { ...storedActor, name: 'Fresh Person' }
    const account = {
      id: 'person',
      username: 'person',
      acct: 'person@remote.test'
    }
    mockGetActorFromUsername.mockResolvedValue(storedActor)
    mockGetServerSession.mockResolvedValue({
      user: { email: 'user@llun.test' }
    })
    mockRecordActorIfNeeded.mockResolvedValue(refreshedActor)
    mockGetMastodonActorFromId.mockResolvedValue(account)

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=person@remote.test'
      )
    )

    expect(response.status).toBe(200)
    expect(mockRecordActorIfNeeded).toHaveBeenCalledWith({
      actorId: storedActor.id,
      database: expect.anything(),
      signingActor: undefined
    })
    // No webfinger needed for a known actor.
    expect(mockGetWebfingerSelf).not.toHaveBeenCalled()
  })

  it('refreshes a known remote actor for bearer viewers with read scope', async () => {
    const storedActor = {
      id: 'https://remote.test/users/person',
      account: null,
      privateKey: ''
    }
    const account = {
      id: 'person',
      username: 'person',
      acct: 'person@remote.test'
    }
    mockGetActorFromUsername.mockResolvedValue(storedActor)
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: 'https://llun.test/users/oauth-user',
      scopes: 'read'
    })
    mockGetActorFromId.mockResolvedValue(oauthActor)
    mockRecordActorIfNeeded.mockResolvedValue(storedActor)
    mockGetMastodonActorFromId.mockResolvedValue(account)

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=person@remote.test',
        { headers: { Authorization: 'Bearer read-token' } }
      )
    )

    expect(response.status).toBe(200)
    expect(mockRecordActorIfNeeded).toHaveBeenCalledWith({
      actorId: storedActor.id,
      database: expect.anything(),
      signingActor: undefined
    })
  })

  it('serves a known remote actor to anonymous viewers without refreshing', async () => {
    const storedActor = {
      id: 'https://remote.test/users/person',
      account: null,
      privateKey: ''
    }
    const account = {
      id: 'person',
      username: 'person',
      acct: 'person@remote.test'
    }
    mockGetActorFromUsername.mockResolvedValue(storedActor)
    mockGetMastodonActorFromId.mockResolvedValue(account)

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=person@remote.test'
      )
    )

    expect(response.status).toBe(200)
    expect(mockRecordActorIfNeeded).not.toHaveBeenCalled()
  })

  it('does not refresh account-backed local actors', async () => {
    const localActor = {
      id: 'https://llun.test/users/test1',
      account: { id: 'account-id' },
      privateKey: 'private-key'
    }
    const account = { id: 'test1', username: 'test1', acct: 'test1' }
    mockGetActorFromUsername.mockResolvedValue(localActor)
    mockGetServerSession.mockResolvedValue({
      user: { email: 'user@llun.test' }
    })
    mockGetMastodonActorFromId.mockResolvedValue(account)

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/accounts/lookup?acct=test1')
    )

    expect(response.status).toBe(200)
    expect(mockRecordActorIfNeeded).not.toHaveBeenCalled()
    // Internal actors skip the auth check entirely.
    expect(mockGetServerSession).not.toHaveBeenCalled()
  })

  it('serves the stored actor when the refresh fails', async () => {
    const storedActor = {
      id: 'https://remote.test/users/person',
      account: null,
      privateKey: ''
    }
    const account = {
      id: 'person',
      username: 'person',
      acct: 'person@remote.test'
    }
    mockGetActorFromUsername.mockResolvedValue(storedActor)
    mockGetServerSession.mockResolvedValue({
      user: { email: 'user@llun.test' }
    })
    mockRecordActorIfNeeded.mockRejectedValue(new Error('remote down'))
    mockGetMastodonActorFromId.mockResolvedValue(account)

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=person@remote.test'
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(account)
  })

  it('rejects an invalid bearer token even when the actor is stored locally', async () => {
    const storedActor = {
      id: 'https://remote.test/users/person',
      account: null,
      privateKey: ''
    }
    mockGetActorFromUsername.mockResolvedValue(storedActor)
    // Default mockStoredToken (null) makes any presented bearer invalid.

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=person@remote.test',
        { headers: { Authorization: 'Bearer expired-token' } }
      )
    )

    expect(response.status).toBe(401)
    // The presented token is validated before any lookup work happens.
    expect(mockGetActorFromUsername).not.toHaveBeenCalled()
    expect(mockRecordActorIfNeeded).not.toHaveBeenCalled()
  })

  it('rejects bearer tokens without read account lookup scope before remote resolution', async () => {
    mockGetActorFromUsername.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: 'https://llun.test/users/oauth-user',
      scopes: 'write'
    })

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/lookup?acct=person@remote.test&resolve=true',
        { headers: { Authorization: 'Bearer write-token' } }
      )
    )

    expect(response.status).toBe(401)
    expect(mockGetServerSession).not.toHaveBeenCalled()
    expect(mockGetWebfingerSelf).not.toHaveBeenCalled()
  })
})
