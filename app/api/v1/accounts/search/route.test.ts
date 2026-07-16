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

  it('resolves an unknown remote handle via webfinger before the indexed search', async () => {
    const resolvedActor = { id: 'https://remote.test/users/charlie' }
    mockGetWebfingerSelf.mockResolvedValue(resolvedActor.id)
    mockRecordActorIfNeeded.mockResolvedValue(resolvedActor)
    mockSearchAccountIds.mockResolvedValue([
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
    expect(mockGetActorFromUsername).toHaveBeenCalledWith({
      username: 'Charlie',
      domain: 'remote.test'
    })
    expect(mockGetWebfingerSelf).toHaveBeenCalledWith({
      account: 'Charlie@remote.test'
    })
    expect(mockSearchAccountIds).toHaveBeenCalledTimes(1)
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
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

  it('refreshes a known remote handle instead of webfingering it', async () => {
    const storedActor = {
      id: 'https://remote.test/users/charlie',
      account: null,
      privateKey: ''
    }
    mockGetActorFromUsername.mockResolvedValue(storedActor)
    mockRecordActorIfNeeded.mockResolvedValue(storedActor)
    mockSearchAccountIds.mockResolvedValue([storedActor.id])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/search?q=charlie@remote.test&resolve=true',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockGetWebfingerSelf).not.toHaveBeenCalled()
    // The stored remote actor is refreshed before serialization so the
    // response carries current remote profile data and counts.
    expect(mockRecordActorIfNeeded).toHaveBeenCalledWith({
      actorId: storedActor.id,
      database: expect.anything(),
      signingActor: undefined
    })
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: 'charlie@remote.test',
      limit: 40,
      offset: 0,
      localDomain: 'llun.test',
      exactActorIds: [storedActor.id]
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

  it('clamps deep search offsets to the maximum', async () => {
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/search?q=runner&offset=10001',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: 'runner',
      limit: 40,
      offset: 10000,
      localDomain: 'llun.test',
      exactActorIds: []
    })
  })

  it('does not webfinger a mixed-case handle whose actor is already stored', async () => {
    const storedActor = {
      id: 'https://remote.test/users/Charlie',
      account: null,
      privateKey: ''
    }
    mockGetActorFromUsername.mockResolvedValue(storedActor)
    mockRecordActorIfNeeded.mockResolvedValue(storedActor)
    mockSearchAccountIds.mockResolvedValue([storedActor.id])
    mockGetMastodonActorsFromIds.mockResolvedValue([
      {
        id: storedActor.id,
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
    // Domain is normalized to lowercase by parseAccountHandle before lookup.
    expect(mockGetActorFromUsername).toHaveBeenCalledWith({
      username: 'Charlie',
      domain: 'remote.test'
    })
    expect(mockGetWebfingerSelf).not.toHaveBeenCalled()
    // Stored remote actors are refreshed before serialization.
    expect(mockRecordActorIfNeeded).toHaveBeenCalledWith({
      actorId: storedActor.id,
      database: expect.anything(),
      signingActor: undefined
    })
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: '@Charlie@Remote.test',
      limit: 40,
      offset: 0,
      localDomain: 'llun.test',
      exactActorIds: [storedActor.id]
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: [storedActor.id]
    })
  })

  it('webfingers unknown remote handles and includes them as exact matches', async () => {
    const resolvedActor = { id: 'https://remote.test/users/charlie' }
    mockGetWebfingerSelf.mockResolvedValue(resolvedActor.id)
    mockRecordActorIfNeeded.mockResolvedValue(resolvedActor)
    mockSearchAccountIds.mockResolvedValue([
      resolvedActor.id,
      'https://llun.test/users/charlie-brown'
    ])
    mockGetMastodonActorsFromIds.mockResolvedValue([
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
    expect(mockSearchAccountIds).toHaveBeenCalledTimes(1)
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
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
