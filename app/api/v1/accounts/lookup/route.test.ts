import { NextRequest } from 'next/server'

import { GET } from './route'

const mockGetActorFromUsername = jest.fn()
const mockGetActorFromId = jest.fn()
const mockGetMastodonActorFromId = jest.fn()
const mockGetWebfingerSelf = jest.fn()
const mockRecordActorIfNeeded = jest.fn()
const mockGetServerSession = jest.fn()
const mockStoredToken = jest.fn()
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

jest.mock('@/lib/database', () => ({
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

jest.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://llun.test',
  getConfig: () => ({ host: 'llun.test' })
}))

jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

jest.mock('@/lib/activities/getWebfingerSelf', () => ({
  getWebfingerSelf: (...args: unknown[]) => mockGetWebfingerSelf(...args)
}))

jest.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: (...args: unknown[]) => mockRecordActorIfNeeded(...args)
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

describe('GET /api/v1/accounts/lookup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
