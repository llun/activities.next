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

  it.each([
    ['min_id', 'min_id'],
    ['since_id', 'since_id']
  ])(
    'collapses %s to since-semantics for the grouped (DESC) scan',
    async (_label, param) => {
      mockDatabase.getNotifications.mockResolvedValueOnce([])

      const request = new NextRequest(
        `https://llun.test/api/v2/notifications?${param}=cursor-1`,
        { method: 'GET' }
      )
      const response = await GET(request, { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      // The grouped v2 path always scans DESC (collectNotificationGroups advances
      // max_id by the oldest row), so both min_id and since_id must reach
      // getNotifications as the since-semantics lower bound — never as
      // minNotificationId, which would flip getNotifications to ascending and
      // break the batching.
      expect(mockDatabase.getNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ sinceNotificationId: 'cursor-1' })
      )
      const callArg = mockDatabase.getNotifications.mock.calls[0][0]
      expect(callArg.minNotificationId).toBeUndefined()
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

  it('splits accounts into full and partial with expand_accounts=partial_avatars', async () => {
    mockDatabase.getMastodonActorsFromIds.mockImplementation(
      ({ ids }: { ids: string[] }) =>
        Promise.resolve(
          ids.map((id) => ({
            id: id.replace(/https?:\/\//, '').replaceAll('/', ':'),
            acct: 'user@other.test',
            url: id,
            avatar: 'https://other.test/avatar.png',
            avatar_static: 'https://other.test/avatar.png',
            avatar_description: 'A friendly avatar',
            locked: false,
            bot: false,
            display_name: 'Only in the full shape'
          }))
        )
    )
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

    const request = new NextRequest(
      'https://llun.test/api/v2/notifications?expand_accounts=partial_avatars',
      { method: 'GET' }
    )
    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    // Only the group's most recent account (alice) is rendered in full — and it
    // keeps the fields a PartialAccountWithAvatar would have stripped, so a
    // regression that truncated the full array too would fail here.
    expect(data.accounts).toHaveLength(1)
    expect(data.accounts[0].id).toBe('other.test:users:alice')
    expect(data.accounts[0].display_name).toBe('Only in the full shape')
    // The rest ship as truncated PartialAccountWithAvatar entries. These MUST
    // carry avatar_description (required by the Mastodon 4.6 entity); a missing
    // key here makes 4.6 clients fail to decode the whole grouped response.
    expect(data.partial_accounts).toEqual([
      {
        id: 'other.test:users:bob',
        acct: 'user@other.test',
        url: 'https://other.test/users/bob',
        avatar: 'https://other.test/avatar.png',
        avatar_static: 'https://other.test/avatar.png',
        avatar_description: 'A friendly avatar',
        locked: false,
        bot: false
      }
    ])
  })

  it('keeps the avatar_description key on partial accounts with empty alt text', async () => {
    // A source actor without stored avatar alt text is serialized with
    // avatar_description: '' (Account schema defaults it). The partial shape must
    // carry that empty string through, never omit the key — a missing key is what
    // makes 4.6 clients fail to decode the whole grouped response.
    mockDatabase.getMastodonActorsFromIds.mockImplementation(
      ({ ids }: { ids: string[] }) =>
        Promise.resolve(
          ids.map((id) => ({
            id: id.replace(/https?:\/\//, '').replaceAll('/', ':'),
            acct: 'user@other.test',
            url: id,
            avatar: 'https://other.test/avatar.png',
            avatar_static: 'https://other.test/avatar.png',
            avatar_description: '',
            locked: false,
            bot: false
          }))
        )
    )
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

    const request = new NextRequest(
      'https://llun.test/api/v2/notifications?expand_accounts=partial_avatars',
      { method: 'GET' }
    )
    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.partial_accounts).toHaveLength(1)
    expect(data.partial_accounts[0]).toHaveProperty('avatar_description', '')
  })

  it('omits partial_accounts with the default expand_accounts=full', async () => {
    mockDatabase.getNotifications.mockResolvedValueOnce([])
    const request = new NextRequest('https://llun.test/api/v2/notifications', {
      method: 'GET'
    })
    const response = await GET(request, { params: Promise.resolve({}) })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.partial_accounts).toBeUndefined()
  })

  it('rejects an unknown expand_accounts value', async () => {
    const request = new NextRequest(
      'https://llun.test/api/v2/notifications?expand_accounts=bogus',
      { method: 'GET' }
    )
    const response = await GET(request, { params: Promise.resolve({}) })
    expect(response.status).toBe(422)
  })
})
