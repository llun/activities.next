import { NextRequest } from 'next/server'

import { GET } from './route'

const mockSearchAccountIds = jest.fn()
const mockGetMastodonActorsFromIds = jest.fn()
const mockSearchHashtags = jest.fn()
const mockSearchStatusIds = jest.fn()
const mockGetStatusesByIds = jest.fn()
const mockGetActorFromId = jest.fn()
const mockGetActorFromUsername = jest.fn()
const mockIsCurrentActorFollowing = jest.fn()
const mockGetStatus = jest.fn()
const mockGetStatusFromUrl = jest.fn()
const mockStoredToken = jest.fn()
const mockGetServerSession = jest.fn()
const mockGetMastodonStatuses = jest.fn()
const mockCanActorReadStatus = jest.fn()
const mockGetWebfingerSelf = jest.fn()
const mockRecordActorIfNeeded = jest.fn()
const mockGetRemoteStatus = jest.fn()
const mockLoggerWarn = jest.fn()

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
    getActorFromUsername: mockGetActorFromUsername,
    isCurrentActorFollowing: mockIsCurrentActorFollowing,
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

jest.mock('@/lib/activities/getWebfingerSelf', () => ({
  getWebfingerSelf: (...args: unknown[]) => mockGetWebfingerSelf(...args)
}))

jest.mock('@/lib/activities/getRemoteStatus', () => ({
  getRemoteStatus: (...args: unknown[]) => mockGetRemoteStatus(...args)
}))

jest.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: (...args: unknown[]) => mockRecordActorIfNeeded(...args)
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args)
  }
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
    mockGetActorFromUsername.mockResolvedValue(null)
    mockIsCurrentActorFollowing.mockResolvedValue(true)
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
    mockGetWebfingerSelf.mockResolvedValue(null)
    mockRecordActorIfNeeded.mockResolvedValue(null)
    mockGetRemoteStatus.mockResolvedValue(null)
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

  it('delegates authenticated full search with filters and ignores offset without type', async () => {
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
      offset: 0,
      followingActorId: oauthActor.id
    })
    expect(mockSearchHashtags).toHaveBeenCalledWith({
      q: 'trail',
      limit: 2,
      offset: 0,
      excludeUnreviewed: false
    })
    expect(mockSearchStatusIds).toHaveBeenCalledWith({
      q: 'trail',
      limit: 2,
      offset: 0,
      currentActorId: oauthActor.id,
      currentActorUsername: oauthActor.username,
      currentActorDomain: oauthActor.domain,
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

  it('normalizes status filter identifiers before database search', async () => {
    const accountId = encodeURIComponent(
      'HTTPS://Remote.test/users/alice#owner'
    )
    const maxId = encodeURIComponent(
      'Remote.test:users:alice:statuses:9#section'
    )
    const minId = encodeURIComponent(
      'https://Remote.test/users/alice/statuses/1#section'
    )
    mockSearchStatusIds.mockResolvedValue([])

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=trail&type=statuses&account_id=${accountId}&max_id=${maxId}&min_id=${minId}`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockSearchStatusIds).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'https://remote.test/users/alice',
        maxId: 'https://remote.test/users/alice/statuses/9',
        minId: 'https://remote.test/users/alice/statuses/1'
      })
    )
  })

  it('requires authentication when offset is provided without an explicit search type', async () => {
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v2/search?q=trail&limit=3&offset=5'
      ),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ status: 'Unauthorized' })
    expect(mockSearchAccountIds).not.toHaveBeenCalled()
    expect(mockSearchHashtags).not.toHaveBeenCalled()
    expect(mockSearchStatusIds).not.toHaveBeenCalled()
  })

  it('requires authentication for typed offset paging', async () => {
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v2/search?q=trail&type=hashtags&limit=3&offset=5'
      ),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ status: 'Unauthorized' })
    expect(mockSearchAccountIds).not.toHaveBeenCalled()
    expect(mockSearchHashtags).not.toHaveBeenCalled()
    expect(mockSearchStatusIds).not.toHaveBeenCalled()
  })

  it('accepts Mastodon-style false boolean query values', async () => {
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v2/search?q=trail&following=0&exclude_unreviewed=off'
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: 'trail',
      limit: 20,
      offset: 0
    })
    expect(mockSearchHashtags).toHaveBeenCalledWith({
      q: 'trail',
      limit: 20,
      offset: 0,
      excludeUnreviewed: false
    })
  })

  it('accepts Mastodon-style truthy boolean query values', async () => {
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v2/search?q=trail&following=2&resolve=',
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: 'trail',
      limit: 20,
      offset: 0,
      followingActorId: oauthActor.id
    })
  })

  it('does not require authentication for account_id without status search', async () => {
    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v2/search?q=trail&account_id=https%3A%2F%2Fremote.test%2Fusers%2Falice'
      ),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockSearchAccountIds).toHaveBeenCalledWith({
      q: 'trail',
      limit: 20,
      offset: 0
    })
    expect(mockSearchHashtags).toHaveBeenCalledWith({
      q: 'trail',
      limit: 20,
      offset: 0,
      excludeUnreviewed: false
    })
    expect(mockSearchStatusIds).not.toHaveBeenCalled()
    expect(data.statuses).toEqual([])
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

  it('resolves uncached remote status URLs', async () => {
    const statusUrl = 'http://remote.test/users/alice/statuses/remote'
    const remoteStatus = {
      id: statusUrl,
      actorId: 'https://remote.test/users/alice'
    }
    mockGetRemoteStatus.mockResolvedValue(remoteStatus)
    mockRecordActorIfNeeded.mockResolvedValue({
      id: remoteStatus.actorId
    })
    mockSearchStatusIds.mockResolvedValue([])

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(statusUrl)}&type=statuses&resolve=2`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockGetRemoteStatus).toHaveBeenCalledWith({
      statusId: statusUrl,
      signingActor: oauthActor
    })
    expect(mockRecordActorIfNeeded).toHaveBeenCalledWith({
      actorId: remoteStatus.actorId,
      database: expect.any(Object),
      signingActor: oauthActor
    })
    expect(mockGetMastodonStatuses).toHaveBeenCalledWith(
      expect.any(Object),
      [remoteStatus],
      oauthActor.id
    )
  })

  it('omits resolved remote statuses when actor recording fails', async () => {
    const statusUrl = 'http://remote.test/users/alice/statuses/remote'
    const remoteStatus = {
      id: statusUrl,
      actorId: 'https://remote.test/users/alice'
    }
    mockGetRemoteStatus.mockResolvedValue(remoteStatus)
    mockRecordActorIfNeeded.mockRejectedValue(new Error('blocked'))
    mockSearchStatusIds.mockResolvedValue([])

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(statusUrl)}&type=statuses&resolve=2`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockCanActorReadStatus).not.toHaveBeenCalled()
    expect(mockGetMastodonStatuses).toHaveBeenCalledWith(
      expect.any(Object),
      [],
      oauthActor.id
    )
    expect(data.statuses).toEqual([])
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to record resolved search actor',
        actorId: remoteStatus.actorId
      })
    )
  })

  it('preserves indexed status order after hydrating statuses', async () => {
    const firstId = 'https://remote.test/users/alice/statuses/1'
    const secondId = 'https://remote.test/users/alice/statuses/2'
    mockSearchStatusIds.mockResolvedValue([firstId, secondId])
    mockGetStatusesByIds.mockResolvedValue([
      {
        id: secondId,
        url: 'https://remote.test/@alice/2',
        actorId: 'https://remote.test/users/alice'
      },
      {
        id: 'https://remote.test/users/alice/statuses/url-only',
        url: firstId,
        actorId: 'https://remote.test/users/alice'
      }
    ])

    const response = await GET(
      new NextRequest('https://llun.test/api/v2/search?q=trail&type=statuses', {
        headers: { Authorization: 'Bearer read-search-token' }
      }),
      context
    )

    expect(response.status).toBe(200)
    expect(mockGetMastodonStatuses).toHaveBeenCalledWith(
      expect.any(Object),
      [
        {
          id: 'https://remote.test/users/alice/statuses/url-only',
          url: firstId,
          actorId: 'https://remote.test/users/alice'
        },
        {
          id: secondId,
          url: 'https://remote.test/@alice/2',
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

  it('resolves uncached account URLs', async () => {
    const accountUrl = 'http://remote.test/users/remote-resolved'
    mockSearchAccountIds.mockResolvedValue([])
    mockRecordActorIfNeeded.mockResolvedValue({
      id: 'https://remote.test/users/remote-resolved'
    })
    mockGetMastodonActorsFromIds.mockResolvedValue([
      {
        id: 'https://remote.test/users/remote-resolved',
        url: accountUrl,
        username: 'remote-resolved'
      }
    ])

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(accountUrl)}&type=accounts&resolve=on`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockRecordActorIfNeeded).toHaveBeenCalledWith({
      actorId: accountUrl,
      database: expect.any(Object),
      signingActor: oauthActor
    })
    expect(data.accounts).toEqual([
      {
        id: 'https://remote.test/users/remote-resolved',
        url: accountUrl,
        username: 'remote-resolved'
      }
    ])
  })

  it('canonicalizes Mastodon account profile URLs before recording actors', async () => {
    const accountUrl = 'https://remote.test/@remote-resolved'
    const canonicalActorId = 'https://remote.test/users/remote-resolved'
    mockSearchAccountIds.mockResolvedValue([])
    mockGetWebfingerSelf.mockResolvedValue(canonicalActorId)
    mockRecordActorIfNeeded.mockResolvedValue({
      id: canonicalActorId
    })
    mockGetMastodonActorsFromIds.mockResolvedValue([
      {
        id: canonicalActorId,
        url: accountUrl,
        username: 'remote-resolved'
      }
    ])

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(accountUrl)}&type=accounts&resolve=on`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockGetWebfingerSelf).toHaveBeenCalledWith({
      account: 'remote-resolved@remote.test'
    })
    expect(mockRecordActorIfNeeded).toHaveBeenCalledWith({
      actorId: canonicalActorId,
      database: expect.any(Object),
      signingActor: oauthActor
    })
    expect(data.accounts).toEqual([
      {
        id: canonicalActorId,
        url: accountUrl,
        username: 'remote-resolved'
      }
    ])
  })

  it('uses existing canonical actors for Mastodon account profile URLs', async () => {
    const accountUrl = 'https://remote.test/@remote-resolved'
    const canonicalActorId = 'https://remote.test/users/remote-resolved'
    mockSearchAccountIds.mockResolvedValue([])
    mockGetWebfingerSelf.mockResolvedValue(canonicalActorId)
    mockGetActorFromId.mockImplementation(({ id }) =>
      Promise.resolve(
        id === oauthActor.id
          ? oauthActor
          : id === canonicalActorId
            ? { id: canonicalActorId }
            : null
      )
    )
    mockGetMastodonActorsFromIds.mockResolvedValue([
      {
        id: canonicalActorId,
        url: accountUrl,
        username: 'remote-resolved'
      }
    ])

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(accountUrl)}&type=accounts&resolve=on`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )

    expect(response.status).toBe(200)
    expect(mockRecordActorIfNeeded).not.toHaveBeenCalled()
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: [canonicalActorId]
    })
  })

  it('omits resolved accounts when actor recording fails', async () => {
    const accountUrl = 'https://remote.test/@blocked'
    const canonicalActorId = 'https://remote.test/users/blocked'
    mockSearchAccountIds.mockResolvedValue([])
    mockGetWebfingerSelf.mockResolvedValue(canonicalActorId)
    mockRecordActorIfNeeded.mockRejectedValue(new Error('blocked'))

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(accountUrl)}&type=accounts&resolve=on`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({ ids: [] })
    expect(data.accounts).toEqual([])
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to record resolved search actor',
        actorId: canonicalActorId
      })
    )
  })

  it('applies the following filter before including resolved accounts', async () => {
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
    mockIsCurrentActorFollowing.mockResolvedValue(false)
    mockSearchAccountIds.mockResolvedValue([])

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v2/search?q=${encodeURIComponent(accountUrl)}&type=accounts&resolve=true&following=true`,
        { headers: { Authorization: 'Bearer read-search-token' } }
      ),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockIsCurrentActorFollowing).toHaveBeenCalledWith({
      currentActorId: oauthActor.id,
      followingActorId: 'https://remote.test/users/resolved'
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({ ids: [] })
    expect(data.accounts).toEqual([])
  })

  it('resolves remote account handles with WebFinger', async () => {
    mockSearchAccountIds.mockResolvedValue([])
    mockGetWebfingerSelf.mockResolvedValue('https://remote.test/users/charlie')
    mockRecordActorIfNeeded.mockResolvedValue({
      id: 'https://remote.test/users/charlie'
    })

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v2/search?q=%40Charlie%40Remote.test&type=accounts&resolve=true',
        { headers: { Authorization: 'Bearer read-search-token' } }
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
    expect(mockRecordActorIfNeeded).toHaveBeenCalledWith({
      actorId: 'https://remote.test/users/charlie',
      database: expect.any(Object),
      signingActor: oauthActor
    })
    expect(mockGetMastodonActorsFromIds).toHaveBeenCalledWith({
      ids: ['https://remote.test/users/charlie']
    })
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
    expect(mockGetRemoteStatus).not.toHaveBeenCalled()
    expect(mockGetStatusesByIds).toHaveBeenCalledWith({
      statusIds: ['https://remote.test/users/alice/statuses/1'],
      currentActorId: oauthActor.id,
      visibleToActorId: oauthActor.id
    })
  })

  it('skips malformed hashtag rows', async () => {
    mockSearchHashtags.mockResolvedValue([
      {
        name: 'trailrunning',
        url: 'https://llun.test/tags/trailrunning',
        history: []
      },
      {
        name: 'broken',
        history: []
      }
    ])

    const response = await GET(
      new NextRequest('https://llun.test/api/v2/search?q=trail&type=hashtags'),
      context
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.hashtags).toEqual([
      {
        name: 'trailrunning',
        url: 'https://llun.test/tags/trailrunning',
        history: []
      }
    ])
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
