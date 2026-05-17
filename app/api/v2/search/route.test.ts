import { NextRequest } from 'next/server'

import { Scope } from '@/lib/types/database/operations'

import { GET } from './route'

const mockSearch = jest.fn()
const mockGetMastodonStatus = jest.fn()
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
  getMastodonStatus: (...args: unknown[]) => mockGetMastodonStatus(...args)
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
    mockGetMastodonStatus.mockResolvedValue({ id: 'mastodon-status-1' })
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
      following: false,
      resolve: false,
      excludeUnreviewed: true
    })
    expect(mockGetMastodonStatus).toHaveBeenCalledWith(
      mockDatabase,
      { id: 'status-1' },
      'actor-1'
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
