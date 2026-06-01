import { NextRequest } from 'next/server'

import { Status, StatusType } from '@/lib/types/domain/status'

import { GET } from './route'

const mockGetMastodonStatuses = jest.fn()
const mockDatabase = {
  getBlockRelations: jest.fn(),
  getMuteRelations: jest.fn(),
  getStatusesByHashtag: jest.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
  OptionalOAuthGuard:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<{ hashtag: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ hashtag: string }> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      }),
  corsErrorResponse: jest.fn()
}))

jest.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
  getMastodonStatuses: (...params: unknown[]) =>
    mockGetMastodonStatuses(...params)
}))

const status = {
  id: 'https://local.test/users/alice/statuses/1',
  actorId: 'https://local.test/users/alice',
  type: StatusType.enum.Note
} as Status

describe('GET /api/v1/timelines/tag/:hashtag', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDatabase.getBlockRelations.mockResolvedValue([])
    mockDatabase.getMuteRelations.mockResolvedValue([])
    mockDatabase.getStatusesByHashtag.mockResolvedValue([status])
    mockGetMastodonStatuses.mockResolvedValue([{ id: '1' }])
  })

  it('passes the current actor id when batch serializing authenticated Mastodon hashtag statuses', async () => {
    const response = await GET(
      new NextRequest('https://local.test/api/v1/timelines/tag/running'),
      { params: Promise.resolve({ hashtag: 'running' }) }
    )

    expect(response.status).toBe(200)
    expect(mockGetMastodonStatuses).toHaveBeenCalledWith(
      mockDatabase,
      [status],
      mockCurrentActor.id
    )
  })
})
