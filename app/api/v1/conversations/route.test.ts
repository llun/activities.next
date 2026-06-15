import { NextRequest } from 'next/server'

import { GET } from './route'

const mockCurrentActor = {
  id: 'https://llun.test/users/llun'
}

const mockDatabase = {
  getDirectConversations: vi.fn()
}

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown[],
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor
      })
}))

vi.mock('@/lib/services/mastodon/getMastodonConversation', () => ({
  getMastodonConversationAccountMap: vi.fn().mockResolvedValue(new Map()),
  getMastodonConversationAccounts: vi.fn().mockReturnValue([]),
  getMastodonConversations: vi.fn(
    async (
      _database: unknown,
      conversations: { id: string }[],
      _currentActorId: string,
      _accountsByActorId: unknown
    ) => conversations.map((conversation) => ({ id: conversation.id }))
  )
}))

const conversation = (id: string) => ({
  id,
  conversationId: `conversation-${id}`,
  lastStatusId: `https://llun.test/users/llun/statuses/${id}`,
  lastStatusCreatedAt: Date.parse('2024-01-01T00:00:00.000Z'),
  unread: false,
  participantActorIds: [mockCurrentActor.id]
})

describe('GET /api/v1/conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('omits next when the final conversations page exactly matches the limit', async () => {
    mockDatabase.getDirectConversations.mockResolvedValueOnce([
      conversation('2'),
      conversation('1')
    ])

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/conversations?limit=2')
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id: '2' }, { id: '1' }])
    expect(response.headers.get('Link') || '').not.toContain('rel="next"')
    expect(mockDatabase.getDirectConversations).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      limit: 3,
      maxId: null,
      minId: null
    })
  })

  it('emits next and returns only the requested conversations when another row exists', async () => {
    mockDatabase.getDirectConversations.mockResolvedValueOnce([
      conversation('3'),
      conversation('2'),
      conversation('1')
    ])

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/conversations?limit=2')
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id: '3' }, { id: '2' }])
    expect(response.headers.get('Link')).toEqual(
      expect.stringContaining('max_id=2')
    )
  })

  it('uses since_id as an alias for min_id when fetching conversations', async () => {
    mockDatabase.getDirectConversations.mockResolvedValueOnce([
      conversation('3')
    ])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/conversations?limit=2&since_id=1'
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id: '3' }])
    expect(mockDatabase.getDirectConversations).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      limit: 3,
      maxId: null,
      minId: '1'
    })
  })

  it('prefers min_id when both min_id and since_id are provided', async () => {
    mockDatabase.getDirectConversations.mockResolvedValueOnce([
      conversation('4')
    ])

    const response = await GET(
      new NextRequest(
        'https://llun.test/api/v1/conversations?min_id=2&since_id=1'
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id: '4' }])
    expect(mockDatabase.getDirectConversations).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      limit: 21,
      maxId: null,
      minId: '2'
    })
  })

  it('keeps the conversations limit capped at 40', async () => {
    mockDatabase.getDirectConversations.mockResolvedValueOnce([])

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/conversations?limit=80')
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(mockDatabase.getDirectConversations).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      limit: 41,
      maxId: null,
      minId: null
    })
  })
})
