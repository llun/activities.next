import { NextRequest } from 'next/server'

import { GET } from './route'

const mockCurrentActor = {
  id: 'https://llun.test/users/llun'
}

const mockDatabase = {
  getDirectConversationStatuses: vi.fn(),
  getActiveFiltersForActor: vi.fn().mockResolvedValue([]),
  getActiveServerFilters: vi.fn().mockResolvedValue([]),
  getStatusPublicIds: vi.fn(async () => new Map<string, string>())
}

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    <TParams>(
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<TParams>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<TParams> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      })
}))

vi.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatuses: vi.fn(
    async (_database: unknown, statuses: { id: string }[]) =>
      statuses.map((status) => ({ id: status.id }))
  )
}))

const status = (id: string) => ({
  id: `https://llun.test/users/llun/statuses/${id}`,
  url: `https://llun.test/users/llun/statuses/${id}`,
  actorId: mockCurrentActor.id,
  type: 'Note',
  text: id,
  createdAt: Date.parse('2024-01-01T00:00:00.000Z')
})

describe('GET /api/v1/conversations/[id]/statuses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getActiveFiltersForActor.mockResolvedValue([])
    mockDatabase.getActiveServerFilters.mockResolvedValue([])
    mockDatabase.getStatusPublicIds.mockResolvedValue(new Map<string, string>())
  })

  const linkCursor = (response: Response, rel: string, param: string) =>
    new URL(
      response.headers
        .get('Link')!
        .split(', ')
        .find((part) => part.includes(`rel="${rel}"`))!
        .match(/<([^>]+)>/)![1]
    ).searchParams.get(param)

  it('omits nextMaxStatusId when the final statuses page exactly matches the limit', async () => {
    mockDatabase.getDirectConversationStatuses.mockResolvedValueOnce([
      status('2'),
      status('1')
    ])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/conversations/conversation-1/statuses?limit=2&format=activities_next'
      ),
      { params: Promise.resolve({ id: 'conversation-1' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      statuses: [status('2'), status('1')],
      nextMaxStatusId: null
    })
    expect(mockDatabase.getDirectConversationStatuses).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      conversationId: 'conversation-1',
      limit: 3,
      minStatusId: null,
      maxStatusId: null
    })
  })

  it('emits nextMaxStatusId and returns only the requested statuses when another row exists', async () => {
    mockDatabase.getDirectConversationStatuses.mockResolvedValueOnce([
      status('3'),
      status('2'),
      status('1')
    ])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/conversations/conversation-1/statuses?limit=2&format=activities_next'
      ),
      { params: Promise.resolve({ id: 'conversation-1' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      statuses: [status('3'), status('2')],
      nextMaxStatusId: status('2').id
    })
  })

  it('emits a Mastodon next Link only when another status row exists', async () => {
    mockDatabase.getDirectConversationStatuses.mockResolvedValueOnce([
      status('3'),
      status('2'),
      status('1')
    ])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/conversations/conversation-1/statuses?limit=2'
      ),
      { params: Promise.resolve({ id: 'conversation-1' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      { id: status('3').id },
      { id: status('2').id }
    ])
    expect(response.headers.get('Link')).toEqual(
      expect.stringContaining('rel="next"')
    )
  })

  it('emits the boundary statuses publicIds as the Link cursors', async () => {
    mockDatabase.getDirectConversationStatuses.mockResolvedValueOnce([
      { ...status('3'), publicId: 'newest-public-id' },
      { ...status('2'), publicId: 'oldest-public-id' },
      { ...status('1'), publicId: 'overflow-public-id' }
    ])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/conversations/conversation-1/statuses?limit=2'
      ),
      { params: Promise.resolve({ id: 'conversation-1' }) }
    )

    expect(response.status).toBe(200)
    expect(linkCursor(response, 'next', 'max_id')).toBe('oldest-public-id')
    expect(linkCursor(response, 'prev', 'min_id')).toBe('newest-public-id')
    // Both boundaries are on the page, so no lookup query is issued.
    expect(mockDatabase.getStatusPublicIds).not.toHaveBeenCalled()
  })

  it('looks up the publicId of a next cursor that was filtered off the page', async () => {
    // Every scanned row is hide-filtered, so the route advertises the last
    // SCANNED id — a status the client never saw and that is not on the page.
    mockDatabase.getActiveServerFilters.mockResolvedValue([
      {
        filter: {
          id: 'server-hide',
          title: 'Server hide',
          context: ['home'],
          filterAction: 'hide',
          expiresAt: null,
          createdAt: 0,
          updatedAt: 0
        },
        keywords: [
          {
            id: 'server-hide:kw',
            filterId: 'server-hide',
            keyword: 'conversation',
            wholeWord: false,
            createdAt: 0,
            updatedAt: 0
          }
        ]
      }
    ])
    mockDatabase.getDirectConversationStatuses.mockResolvedValue([
      { ...status('3'), text: 'conversation hidden' },
      { ...status('2'), text: 'conversation hidden' },
      { ...status('1'), text: 'conversation hidden' }
    ])
    mockDatabase.getStatusPublicIds.mockResolvedValue(
      new Map([[status('1').id, 'scanned-public-id']])
    )

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/conversations/conversation-1/statuses?limit=2'
      ),
      { params: Promise.resolve({ id: 'conversation-1' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(mockDatabase.getStatusPublicIds).toHaveBeenCalledWith({
      statusIds: [status('1').id]
    })
    expect(linkCursor(response, 'next', 'max_id')).toBe('scanned-public-id')
  })
})
