import { NextRequest } from 'next/server'

import { GET } from './route'

const mockDatabase = {
  getNotifications: vi.fn(),
  getMastodonActorsFromIds: vi.fn(),
  getStatus: vi.fn(),
  getStatusesByIds: vi.fn(),
  getActiveFiltersForActor: vi.fn().mockResolvedValue([]),
  getActiveServerFilters: vi.fn().mockResolvedValue([])
}

const mockCurrentActor = { id: 'https://llun.test/users/llun' }

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  // Return id matching urlToId(domainStatus.id) so the hide-filter check works.
  getMastodonStatus: vi
    .fn()
    .mockImplementation((_db: unknown, domainStatus: { id: string }) =>
      Promise.resolve({
        id: domainStatus.id.replace(/https?:\/\//, '').replaceAll('/', ':')
      })
    )
}))

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: {
          currentActor: typeof mockCurrentActor
          params: Promise<{}>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) =>
      handle(req, { currentActor: mockCurrentActor, params: context.params }),
  OAuthGuardAnyScope:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: {
          currentActor: typeof mockCurrentActor
          params: Promise<{}>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{}> }) =>
      handle(req, { currentActor: mockCurrentActor, params: context.params })
}))

describe('GET /api/v2/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Return id in urlToId format so sample_account_ids filtering works.
    mockDatabase.getMastodonActorsFromIds.mockImplementation(
      ({ ids }: { ids: string[] }) =>
        Promise.resolve(
          ids.map((id) => ({
            id: id.replace(/https?:\/\//, '').replaceAll('/', ':')
          }))
        )
    )
    mockDatabase.getStatus.mockResolvedValue({ id: 'status-url' })
    mockDatabase.getStatusesByIds.mockImplementation(
      ({ statusIds }: { statusIds: string[] }) =>
        Promise.resolve(statusIds.map((id) => ({ id })))
    )
  })

  it('returns the grouped envelope with deduped accounts and statuses', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([
      {
        id: 'n1',
        type: 'like',
        sourceActorId: 'https://other.test/users/alice',
        statusId: 'https://other.test/statuses/1',
        groupKey: 'like:https://other.test/statuses/1',
        isRead: false,
        filtered: false,
        createdAt: 2000,
        updatedAt: 2000
      },
      {
        id: 'n2',
        type: 'like',
        sourceActorId: 'https://other.test/users/bob',
        statusId: 'https://other.test/statuses/1',
        groupKey: 'like:https://other.test/statuses/1',
        isRead: false,
        filtered: false,
        createdAt: 1000,
        updatedAt: 1000
      }
    ])

    const request = new NextRequest('https://llun.test/api/v2/notifications', {
      method: 'GET'
    })
    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    // Two likes on one status collapse into a single group.
    expect(data.notification_groups).toHaveLength(1)
    expect(data.notification_groups[0]).toMatchObject({
      type: 'favourite',
      notifications_count: 2
    })
    expect(data.accounts).toHaveLength(2)
    expect(data.statuses).toHaveLength(1)
    expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ includeFiltered: false })
    )
  })

  it.each([
    ['below the minimum', '0', 1],
    ['above the maximum', '100', 80]
  ])(
    'clamps an out-of-range limit (%s) instead of rejecting it',
    async (_label, limit, clamped) => {
      mockDatabase.getNotifications.mockResolvedValueOnce([])

      const request = new NextRequest(
        `https://llun.test/api/v2/notifications?limit=${limit}`,
        { method: 'GET' }
      )
      const response = await GET(request, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      // The route over-fetches GROUP_OVERSCAN (5) rows per requested group, so
      // the clamped limit reaches getNotifications as limit = clampedLimit * 5.
      expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ limit: clamped * 5 })
      )
    }
  )

  it('anchors the next (max_id) Link on the last returned group most-recent id', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([
      {
        id: 'like-new',
        type: 'like',
        sourceActorId: 'https://other.test/users/alice',
        statusId: 'https://other.test/statuses/1',
        groupKey: 'like:https://other.test/statuses/1',
        isRead: false,
        filtered: false,
        createdAt: 3000,
        updatedAt: 3000
      },
      {
        id: 'follow-old',
        type: 'follow',
        sourceActorId: 'https://other.test/users/bob',
        groupKey: 'follow:1',
        isRead: false,
        filtered: false,
        createdAt: 1000,
        updatedAt: 1000
      }
    ])

    const request = new NextRequest(
      'https://llun.test/api/v2/notifications?limit=2',
      { method: 'GET' }
    )
    const response = await GET(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const link = response.headers.get('Link') ?? ''
    // next/max_id anchors on the LAST returned group (the follow group).
    expect(link).toContain('max_id=follow-old')
    expect(link).toContain('rel="next"')
    // prev/min_id anchors on the FIRST returned group (the like group).
    expect(link).toContain('min_id=like-new')
    expect(link).toContain('rel="prev"')
  })
})
