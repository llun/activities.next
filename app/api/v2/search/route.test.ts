import { NextRequest } from 'next/server'

import { Scope } from '@/lib/types/database/operations'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockSearch = jest.fn()
const mockGetMastodonStatuses = jest.fn()
const mockDatabase = {}
let mockCurrentActor: { id: string } | null = { id: 'actor-1' }

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
  OptionalOAuthGuardAnyScope:
    (
      scopes: Scope[],
      handle: (
        req: NextRequest,
        context: {
          currentActor: typeof mockCurrentActor
          database: typeof mockDatabase
          params: Promise<Record<string, never>>
        }
      ) => Promise<Response>
    ) =>
    (req: NextRequest) => {
      expect(scopes).toEqual(['read', 'read:search'])
      return handle(req, {
        currentActor: mockCurrentActor,
        database: mockDatabase,
        params: Promise.resolve({})
      })
    },
  corsErrorResponse: jest.fn()
}))

jest.mock('@/lib/search', () => ({
  search: (...args: unknown[]) => mockSearch(...args)
}))

jest.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatuses: (...args: unknown[]) => mockGetMastodonStatuses(...args)
}))

describe('GET /api/v2/search', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCurrentActor = { id: 'actor-1' }
    mockSearch.mockResolvedValue({
      accounts: [{ id: 'account-1' }],
      statuses: [{ id: 'status-1' }],
      hashtags: [{ name: 'trailrun', url: 'https://local.test/tags/trailrun' }]
    })
    mockGetMastodonStatuses.mockResolvedValue([{ id: 'mastodon-status-1' }])
  })

  it('returns empty search results for a blank query', async () => {
    const response = await GET(
      new NextRequest('https://local.test/api/v2/search?q=+')
    )

    await expect(response.json()).resolves.toEqual({
      accounts: [],
      statuses: [],
      hashtags: []
    })
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('requires authentication for auth-sensitive blank queries', async () => {
    mockCurrentActor = null

    const response = await GET(
      new NextRequest(
        'https://local.test/api/v2/search?q=+&type=statuses&resolve=true'
      )
    )

    expect(response.status).toBe(401)
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('searches and serializes all result groups for authenticated requests', async () => {
    const response = await GET(
      new NextRequest(
        'https://local.test/api/v2/search?q=trail&limit=5&exclude_unreviewed=true'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accounts: [{ id: 'account-1' }],
      statuses: [{ id: 'mastodon-status-1' }],
      hashtags: [{ name: 'trailrun', url: 'https://local.test/tags/trailrun' }]
    })
    expect(mockSearch).toHaveBeenCalledWith({
      database: mockDatabase,
      query: 'trail',
      limit: 5,
      offset: 0,
      currentActorId: 'actor-1',
      includeAccounts: true,
      includeStatuses: true,
      includeHashtags: true,
      accountId: undefined,
      maxStatusId: undefined,
      minStatusId: undefined,
      following: undefined,
      resolve: undefined,
      excludeUnreviewed: true
    })
    expect(mockGetMastodonStatuses).toHaveBeenCalledWith(
      mockDatabase,
      [{ id: 'status-1' }],
      'actor-1'
    )
  })

  it('decodes API IDs before applying status filters', async () => {
    const accountId = 'https://local.test/users/alice'
    const minStatusId = 'https://local.test/users/alice/statuses/2'
    const maxStatusId = 'https://local.test/users/alice/statuses/9'
    const params = new URLSearchParams({
      q: 'trail',
      type: 'statuses',
      account_id: urlToId(accountId),
      min_id: urlToId(minStatusId),
      max_id: urlToId(maxStatusId)
    })

    const response = await GET(
      new NextRequest(`https://local.test/api/v2/search?${params.toString()}`)
    )

    expect(response.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        minStatusId,
        maxStatusId
      })
    )
  })

  it('does not decode raw URLs or opaque cursor values', async () => {
    const accountId = 'https://local.test/users/alice'
    const params = new URLSearchParams({
      q: 'trail',
      type: 'statuses',
      account_id: accountId,
      min_id: '123',
      max_id: 'opaque-cursor'
    })

    const response = await GET(
      new NextRequest(`https://local.test/api/v2/search?${params.toString()}`)
    )

    expect(response.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        minStatusId: '123',
        maxStatusId: 'opaque-cursor'
      })
    )
  })

  it('does not run status search for anonymous broad searches', async () => {
    mockCurrentActor = null

    const response = await GET(
      new NextRequest('https://local.test/api/v2/search?q=trail')
    )

    expect(response.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        currentActorId: undefined,
        includeAccounts: true,
        includeStatuses: false,
        includeHashtags: true
      })
    )
  })

  it('requires authentication for typed offset pagination', async () => {
    mockCurrentActor = null

    const response = await GET(
      new NextRequest(
        'https://local.test/api/v2/search?q=trail&type=accounts&offset=1'
      )
    )

    expect(response.status).toBe(401)
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('ignores offset for broad searches', async () => {
    const response = await GET(
      new NextRequest('https://local.test/api/v2/search?q=trail&offset=5')
    )

    expect(response.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        offset: 0
      })
    )
  })

  it('preserves offset for typed searches', async () => {
    const response = await GET(
      new NextRequest(
        'https://local.test/api/v2/search?q=trail&type=accounts&offset=5'
      )
    )

    expect(response.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        offset: 5
      })
    )
  })

  it('preserves explicit false boolean params', async () => {
    const response = await GET(
      new NextRequest(
        'https://local.test/api/v2/search?q=trail&following=0&resolve=off&exclude_unreviewed=f'
      )
    )

    expect(response.status).toBe(200)
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        following: false,
        resolve: false,
        excludeUnreviewed: false
      })
    )
  })

  it('requires authentication for explicit status search', async () => {
    mockCurrentActor = null

    const response = await GET(
      new NextRequest('https://local.test/api/v2/search?q=trail&type=statuses')
    )

    expect(response.status).toBe(401)
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('requires authentication before resolving remote accounts', async () => {
    mockCurrentActor = null

    const response = await GET(
      new NextRequest('https://local.test/api/v2/search?q=alice&resolve=true')
    )

    expect(response.status).toBe(401)
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('rejects queries longer than 500 characters', async () => {
    const response = await GET(
      new NextRequest(`https://local.test/api/v2/search?q=${'a'.repeat(501)}`)
    )

    expect(response.status).toBe(400)
    expect(mockSearch).not.toHaveBeenCalled()
  })
})
