import { NextRequest } from 'next/server'

import { GET } from './route'

const mockSearchAccountIds = jest.fn()
const mockGetMastodonActorsFromIds = jest.fn()
const mockSearchHashtags = jest.fn()
const mockSearchStatusIds = jest.fn()
const mockGetStatusesByIds = jest.fn()
const mockGetActorFromId = jest.fn()
const mockGetStatus = jest.fn()
const mockGetStatusFromUrl = jest.fn()
const mockStoredToken = jest.fn()
const mockGetServerSession = jest.fn()
const mockGetMastodonStatuses = jest.fn()
const mockCanActorReadStatus = jest.fn()

const oauthActor = {
  id: 'https://llun.test/users/searcher',
  username: 'searcher',
  domain: 'llun.test',
  followersUrl: 'https://llun.test/users/searcher/followers',
  inboxUrl: 'https://llun.test/users/searcher/inbox',
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
    searchHashtags: mockSearchHashtags,
    searchStatusIds: mockSearchStatusIds,
    getStatusesByIds: mockGetStatusesByIds,
    getActorFromId: mockGetActorFromId,
    getStatus: mockGetStatus,
    getStatusFromUrl: mockGetStatusFromUrl
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

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

jest.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatuses: (...args: unknown[]) => mockGetMastodonStatuses(...args)
}))

jest.mock('@/lib/services/statusAccess', () => ({
  canActorReadStatus: (...args: unknown[]) => mockCanActorReadStatus(...args)
}))

const context = { params: Promise.resolve({}) }

describe('GET /api/v2/search', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: oauthActor.id,
      scopes: 'read:search'
    })
    mockGetActorFromId.mockImplementation(({ id }) =>
      Promise.resolve(id === oauthActor.id ? oauthActor : null)
    )
    mockSearchAccountIds.mockResolvedValue(['https://remote.test/users/alice'])
    mockGetMastodonActorsFromIds.mockImplementation(({ ids }) =>
      Promise.resolve(
        ids.map((id: string) => ({
          id,
          username: id.split('/').at(-1) ?? id
        }))
      )
    )
    mockSearchHashtags.mockResolvedValue([
      {
        name: 'trailrunning',
        url: 'https://llun.test/tags/trailrunning',
        history: [],
        postCount: 2,
        lastPostAt: 1
      }
    ])
    mockSearchStatusIds.mockResolvedValue([
      'https://remote.test/users/alice/statuses/1'
    ])
    mockGetStatusesByIds.mockImplementation(({ statusIds }) =>
      Promise.resolve(
        statusIds.map((id: string) => ({
          id,
          actorId: 'https://remote.test/users/alice'
        }))
      )
    )
    mockGetMastodonStatuses.mockImplementation((_database, statuses) =>
      Promise.resolve(
        statuses.map((status: { id: string }) => ({
          id: status.id,
          content: status.id
        }))
      )
    )
    mockGetStatus.mockResolvedValue(null)
    mockGetStatusFromUrl.mockResolvedValue(null)
    mockCanActorReadStatus.mockResolvedValue(true)
  })

  it('allows anonymous account and hashtag search but omits statuses', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/search?q=trail&limit=3'),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: 'trail',
      limit: 3,
      offset: 0
    })
    expect(mockSearchHashtags).toHaveBeenCalledWith({
      q: 'trail',
      limit: 3,
      offset: 0,
      excludeUnreviewed: false
    })
    expect(mockSearchStatusIds).not.toHaveBeenCalled()
    expect(data).toEqual({
      accounts: [
        {
          id: 'https://remote.test/users/alice',
          username: 'alice'
        }
      ],
      statuses: [],
      hashtags: [
        {
          name: 'trailrunning',
          url: 'https://llun.test/tags/trailrunning',
          history: []
        }
      ]
    })
  })

  it('delegates authenticated full search with filters and preserves status order', async () => {
    const accountId = encodeURIComponent('https://remote.test/users/alice')
    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=trail&limit=2&offset=1&following=true&account_id=${accountId}&max_id=https%3A%2F%2Fremote.test%2Fusers%2Falice%2Fstatuses%2F9&min_id=https%3A%2F%2Fremote.test%2Fusers%2Falice%2Fstatuses%2F1`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: 'trail',
      limit: 2,
      offset: 1,
      followingActorId: oauthActor.id
    })
    expect(mockSearchStatusIds).toHaveBeenCalledWith({
      q: 'trail',
      limit: 2,
      offset: 1,
      currentActorId: oauthActor.id,
      accountId: 'https://remote.test/users/alice',
      maxId: 'https://remote.test/users/alice/statuses/9',
      minId: 'https://remote.test/users/alice/statuses/1'
    })
    expect(mockGetStatusesByIds).toHaveBeenCalledWith({
      statusIds: ['https://remote.test/users/alice/statuses/1'],
      currentActorId: oauthActor.id,
      visibleToActorId: oauthActor.id
    })
    expect(data.statuses).toEqual([
      {
        id: 'https://remote.test/users/alice/statuses/1',
        content: 'https://remote.test/users/alice/statuses/1'
      }
    ])
  })

  it('requires authentication for explicit status search', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/search?q=trail&type=statuses'),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ status: 'Unauthorized' })
    expect(mockSearchStatusIds).not.toHaveBeenCalled()
  })

  it('prepends a resolved readable status URL before indexed results', async () => {
    const statusUrl = 'http://remote.test/users/alice/statuses/resolved'
    const resolvedStatus = {
      id: 'https://remote.test/users/alice/statuses/resolved',
      actorId: 'https://remote.test/users/alice'
    }
    mockGetStatus.mockResolvedValue(resolvedStatus)
    mockSearchStatusIds.mockResolvedValue([
      resolvedStatus.id,
      'https://remote.test/users/alice/statuses/indexed'
    ])

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(statusUrl)}&type=statuses&resolve=true`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockCanActorReadStatus).toHaveBeenCalledWith({
      database: expect.any(Object),
      status: resolvedStatus,
      currentActor: oauthActor
    })
    expect(mockGetStatusesByIds).toHaveBeenCalledWith({
      statusIds: ['https://remote.test/users/alice/statuses/indexed'],
      currentActorId: oauthActor.id,
      visibleToActorId: oauthActor.id
    })
    expect(mockGetMastodonStatuses).toHaveBeenCalledWith(
      expect.any(Object),
      [
        resolvedStatus,
        {
          id: 'https://remote.test/users/alice/statuses/indexed',
          actorId: 'https://remote.test/users/alice'
        }
      ],
      oauthActor.id
    )
  })

  it('resolves account URLs only on the first page and preserves hydration order', async () => {
    const accountUrl = 'http://remote.test/users/resolved'
    mockGetActorFromId.mockImplementation(({ id }) =>
      Promise.resolve(
        id === oauthActor.id
          ? oauthActor
          : id === accountUrl
            ? { id: 'https://remote.test/users/resolved' }
            : null
      )
    )
    mockSearchAccountIds.mockResolvedValue([
      'https://remote.test/users/indexed'
    ])
    mockGetMastodonActorsFromIds.mockResolvedValue([
      {
        id: 'https://remote.test/users/indexed',
        url: 'https://remote.test/@indexed',
        username: 'indexed'
      },
      {
        id: 'https://remote.test/users/resolved',
        url: accountUrl,
        username: 'resolved'
      }
    ])

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(accountUrl)}&type=accounts&resolve=true`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: [
        'https://remote.test/users/resolved',
        'https://remote.test/users/indexed'
      ]
    })
    expect(data.accounts).toEqual([
      {
        id: 'https://remote.test/users/resolved',
        url: accountUrl,
        username: 'resolved'
      },
      {
        id: 'https://remote.test/users/indexed',
        url: 'https://remote.test/@indexed',
        username: 'indexed'
      }
    ])
  })

  it('does not resolve account URLs after the first page', async () => {
    const accountUrl = 'http://remote.test/users/resolved'

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(accountUrl)}&type=accounts&resolve=true&offset=1`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockGetActorFromId).toHaveBeenCalledTimes(1)
    expect(mockGetActorFromId).toHaveBeenCalledWith({ id: oauthActor.id })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: ['https://remote.test/users/alice']
    })
  })

  it('does not resolve status URLs after the first page', async () => {
    const statusUrl = 'http://remote.test/users/alice/statuses/resolved'

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(statusUrl)}&type=statuses&resolve=true&offset=1`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockGetStatus).not.toHaveBeenCalled()
    expect(mockGetStatusFromUrl).not.toHaveBeenCalled()
    expect(mockGetStatusesByIds).toHaveBeenCalledWith({
      statusIds: ['https://remote.test/users/alice/statuses/1'],
      currentActorId: oauthActor.id,
      visibleToActorId: oauthActor.id
    })
  })

  it('rejects invalid search parameters', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/api/v2/search?q=trail&limit=100'),
      context
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ status: 'Bad Request' })
  })
})
