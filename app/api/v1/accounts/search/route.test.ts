import { NextRequest } from 'next/server'

import { GET } from './route'

const mockSearchAccountIds = vi.fn()
const mockGetMastodonActorsFromIds = vi.fn()
const mockGetActorFromId = vi.fn()
const mockGetActorFromUsername = vi.fn()
const mockGetWebfingerSelf = vi.fn()
const mockRecordActorIfNeeded = vi.fn()
const mockIsCurrentActorFollowing = vi.fn()
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
    searchAccountIds: mockSearchAccountIds,
    getMastodonActorsFromIds: mockGetMastodonActorsFromIds,
    getActorFromId: mockGetActorFromId,
    getActorFromUsername: mockGetActorFromUsername,
    isCurrentActorFollowing: mockIsCurrentActorFollowing
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

const context = { params: Promise.resolve({}) }

describe('GET /api/v1/accounts/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: oauthActor.id,
      scopes: 'read:accounts'
    })
    mockGetActorFromId.mockResolvedValue(oauthActor)
    mockGetActorFromUsername.mockResolvedValue(null)
    mockSearchAccountIds.mockResolvedValue([
      'https://remote.test/users/alice',
      'https://remote.test/users/bob'
    ])
    mockIsCurrentActorFollowing.mockResolvedValue(false)
    mockGetMastodonActorsFromIds.mockImplementation(({ ids }) =>
      Promise.resolve(ids.map((id: string) => ({ id, username: id })))
    )
  })

  it('delegates indexed account search with offset and following filters', async () => {
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/search?q=runner&limit=2&offset=1&following=true',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: 'runner',
      limit: 2,
      offset: 1,
      localDomain: 'llun.test',
      exactActorIds: [],
      followingActorId: oauthActor.id
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: ['https://remote.test/users/alice', 'https://remote.test/users/bob']
    })
  })

  it('resolves a remote handle only after indexed search misses', async () => {
    const resolvedActor = { id: 'https://remote.test/users/charlie' }
    mockGetWebfingerSelf.mockResolvedValue(resolvedActor.id)
    mockRecordActorIfNeeded.mockResolvedValue(resolvedActor)
    mockSearchAccountIds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        resolvedActor.id,
        'https://remote.test/users/alice'
      ])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/search?q=@Charlie@Remote.test&resolve=true',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockGetActorFromUsername).not.toHaveBeenCalled()
    expect(mockSearchAccountIds).toHaveBeenNthCalledWith(1, {
      q: '@Charlie@Remote.test',
      limit: 40,
      offset: 0,
      localDomain: 'llun.test',
      exactActorIds: []
    })
    expect(mockGetWebfingerSelf).toHaveBeenCalledWith({
      account: 'Charlie@remote.test'
    })
    expect(mockSearchAccountIds).toHaveBeenNthCalledWith(2, {
      q: '@Charlie@Remote.test',
      limit: 40,
      offset: 0,
      localDomain: 'llun.test',
      exactActorIds: [resolvedActor.id]
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: [resolvedActor.id, 'https://remote.test/users/alice']
    })
  })

  it('delegates local exact username resolution to indexed search', async () => {
    const localActor = { id: 'https://llun.test/users/local-runner' }
    mockSearchAccountIds.mockResolvedValue([localActor.id])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/search?q=local-runner&following=true',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockGetActorFromUsername).not.toHaveBeenCalled()
    expect(mockIsCurrentActorFollowing).not.toHaveBeenCalled()
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: 'local-runner',
      limit: 40,
      offset: 0,
      localDomain: 'llun.test',
      exactActorIds: [],
      followingActorId: oauthActor.id
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: [localActor.id]
    })
  })

  it('does not resolve remote handles after the first page', async () => {
    mockSearchAccountIds.mockResolvedValue(['https://remote.test/users/alice'])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/search?q=@charlie@remote.test&resolve=true&offset=1',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockGetWebfingerSelf).not.toHaveBeenCalled()
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: '@charlie@remote.test',
      limit: 40,
      offset: 1,
      localDomain: 'llun.test',
      exactActorIds: []
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: ['https://remote.test/users/alice']
    })
  })

  it('rejects deep search offsets', async () => {
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/search?q=runner&offset=10001',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      ),
      context
    )

    expect(response.status).toBe(400)
    expect(mockSearchAccountIds).not.toHaveBeenCalled()
  })

  it('does not webfinger when indexed search finds a mixed-case handle locally', async () => {
    mockSearchAccountIds.mockResolvedValue([
      'https://remote.test/users/Charlie'
    ])
    mockGetMastodonActorsFromIds.mockResolvedValue([
      {
        id: 'https://remote.test/users/Charlie',
        username: 'Charlie',
        acct: 'Charlie@remote.test'
      }
    ])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/search?q=@Charlie@Remote.test&resolve=true',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockGetActorFromUsername).not.toHaveBeenCalled()
    expect(mockGetWebfingerSelf).not.toHaveBeenCalled()
    expect(mockRecordActorIfNeeded).not.toHaveBeenCalled()
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: '@Charlie@Remote.test',
      limit: 40,
      offset: 0,
      localDomain: 'llun.test',
      exactActorIds: []
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: ['https://remote.test/users/Charlie']
    })
  })

  it('webfingers remote handles when indexed search only finds unrelated accounts', async () => {
    const resolvedActor = { id: 'https://remote.test/users/charlie' }
    mockGetWebfingerSelf.mockResolvedValue(resolvedActor.id)
    mockRecordActorIfNeeded.mockResolvedValue(resolvedActor)
    mockSearchAccountIds
      .mockResolvedValueOnce(['https://llun.test/users/charlie-brown'])
      .mockResolvedValueOnce([
        resolvedActor.id,
        'https://llun.test/users/charlie-brown'
      ])
    mockGetMastodonActorsFromIds
      .mockResolvedValueOnce([
        {
          id: 'https://llun.test/users/charlie-brown',
          username: 'charlie-brown',
          acct: 'charlie-brown@llun.test'
        }
      ])
      .mockResolvedValueOnce([
        {
          id: resolvedActor.id,
          username: 'charlie',
          acct: 'charlie@remote.test'
        },
        {
          id: 'https://llun.test/users/charlie-brown',
          username: 'charlie-brown',
          acct: 'charlie-brown@llun.test'
        }
      ])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/search?q=@charlie@remote.test&resolve=true',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockGetWebfingerSelf).toHaveBeenCalledWith({
      account: 'charlie@remote.test'
    })
    expect(mockSearchAccountIds).toHaveBeenNthCalledWith(2, {
      q: '@charlie@remote.test',
      limit: 40,
      offset: 0,
      localDomain: 'llun.test',
      exactActorIds: [resolvedActor.id]
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenLastCalledWith({
      ids: [resolvedActor.id, 'https://llun.test/users/charlie-brown']
    })
  })
})
