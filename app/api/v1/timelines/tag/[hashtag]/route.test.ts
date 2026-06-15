import { NextRequest } from 'next/server'

import { Status, StatusType } from '@/lib/types/domain/status'

import { GET } from './route'

const mockGetMastodonStatuses = vi.fn()
const mockDatabase = {
  getBlockRelations: vi.fn(),
  getMuteRelations: vi.fn(),
  getStatusesByHashtag: vi.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
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
  corsErrorResponse: vi.fn()
}))

vi.mock('@/lib/services/mastodon/getMastodonStatus', () => ({
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
    vi.clearAllMocks()
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

  it.each([
    { description: 'max_id', field: 'max_id' },
    { description: 'min_id', field: 'min_id' },
    { description: 'since_id', field: 'since_id' }
  ])(
    'returns 400 (not 500) for a malformed $description cursor',
    async ({ field }) => {
      const url = new URL('https://local.test/api/v1/timelines/tag/running')
      url.searchParams.set(field, 'apurl_@@@@')
      const response = await GET(new NextRequest(url.toString()), {
        params: Promise.resolve({ hashtag: 'running' })
      })

      expect(response.status).toBe(400)
      expect(mockDatabase.getStatusesByHashtag).not.toHaveBeenCalled()
    }
  )

  it('returns an empty array and no Link header when there are no statuses', async () => {
    mockDatabase.getStatusesByHashtag.mockResolvedValue([])
    mockGetMastodonStatuses.mockResolvedValue([])

    const response = await GET(
      new NextRequest('https://local.test/api/v1/timelines/tag/running'),
      { params: Promise.resolve({ hashtag: 'running' }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
    expect(response.headers.get('Link')).toBeNull()
  })
})
