import { NextRequest } from 'next/server'

import { GET } from './route'

const mockCurrentActor = {
  id: 'https://llun.test/users/llun'
}

const mockDatabase = {
  getDirectConversationStatuses: jest.fn()
}

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
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

jest.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatuses: jest.fn(
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
    jest.clearAllMocks()
  })

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
      nextMaxStatusId: null,
      prevMinStatusId: status('2').id
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
      nextMaxStatusId: status('2').id,
      prevMinStatusId: status('3').id
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
})
