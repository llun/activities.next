import { NextRequest } from 'next/server'

import { GET } from './route'

const mockSearchAccountIds = jest.fn()
const mockGetMastodonActorsFromIds = jest.fn()
const mockGetActorFromId = jest.fn()
const mockGetActorFromUsername = jest.fn()
const mockGetWebfingerSelf = jest.fn()
const mockRecordActorIfNeeded = jest.fn()
const mockIsCurrentActorFollowing = jest.fn()
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

const context = { params: Promise.resolve({}) }

describe('GET /api/v1/accounts/search', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
      exactActorIds: [],
      followingActorId: oauthActor.id
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: ['https://remote.test/users/alice', 'https://remote.test/users/bob']
    })
  })

  it('prepends a resolved exact remote handle before indexed broad results', async () => {
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
    expect(mockGetWebfingerSelf).toHaveBeenCalledWith({
      account: 'charlie@remote.test'
    })
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: '@Charlie@Remote.test',
      limit: 40,
      offset: 0,
      exactActorIds: [resolvedActor.id]
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: [resolvedActor.id, 'https://remote.test/users/alice']
    })
  })

  it('includes followed local exact matches when following is true', async () => {
    const localActor = { id: 'https://llun.test/users/local-runner' }
    mockGetActorFromUsername.mockResolvedValue(localActor)
    mockIsCurrentActorFollowing.mockResolvedValue(true)
    mockSearchAccountIds.mockResolvedValue([localActor.id])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/search?q=local-runner&following=true',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockIsCurrentActorFollowing).toHaveBeenCalledWith({
      currentActorId: oauthActor.id,
      followingActorId: localActor.id
    })
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: 'local-runner',
      limit: 40,
      offset: 0,
      exactActorIds: [localActor.id],
      followingActorId: oauthActor.id
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: [localActor.id]
    })
  })

  it('does not prepend exact matches after the first page', async () => {
    const resolvedActor = { id: 'https://remote.test/users/charlie' }
    mockGetWebfingerSelf.mockResolvedValue(resolvedActor.id)
    mockRecordActorIfNeeded.mockResolvedValue(resolvedActor)
    mockSearchAccountIds.mockResolvedValue(['https://remote.test/users/alice'])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/accounts/search?q=@charlie@remote.test&resolve=true&offset=1',
        { headers: { Authorization: 'Bearer read-accounts-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: '@charlie@remote.test',
      limit: 40,
      offset: 1,
      exactActorIds: [resolvedActor.id]
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: ['https://remote.test/users/alice']
    })
  })
})
