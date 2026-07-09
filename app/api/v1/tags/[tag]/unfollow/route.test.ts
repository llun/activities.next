import { NextRequest } from 'next/server'

import { POST } from './route'

const mockDatabase = {
  getTagDailyHistory: vi.fn(),
  unfollowTag: vi.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'local.test' })
}))

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
          params: Promise<{ tag: string }>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<{ tag: string }> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context.params
      }),
  corsErrorResponse: vi.fn()
}))

describe('POST /api/v1/tags/:tag/unfollow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.unfollowTag.mockResolvedValue(null)
    mockDatabase.getTagDailyHistory.mockResolvedValue(new Map())
  })

  it('returns the unfollowed Tag entity with its seven-day history', async () => {
    const DAY_MS = 86_400_000
    const todayBucketMs = Math.floor(Date.now() / DAY_MS) * DAY_MS
    mockDatabase.getTagDailyHistory.mockResolvedValue(
      new Map([
        ['running', [{ dayBucketMs: todayBucketMs, uses: 2, accounts: 1 }]]
      ])
    )

    const response = await POST(
      new NextRequest('https://local.test/api/v1/tags/running/unfollow', {
        method: 'POST'
      }),
      { params: Promise.resolve({ tag: 'running' }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.following).toBe(false)
    expect(body.history).toHaveLength(7)
    expect(body.history[0]).toEqual({
      day: String(todayBucketMs / 1000),
      uses: '2',
      accounts: '1'
    })
    expect(mockDatabase.unfollowTag).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      name: 'running'
    })
  })

  it.each([
    {
      description: 'accepts a unicode hashtag name',
      tag: '日本語',
      expectedStatus: 200
    },
    {
      description: 'rejects a name containing spaces',
      tag: 'not a tag',
      expectedStatus: 400
    }
  ])('$description', async ({ tag, expectedStatus }) => {
    const response = await POST(
      new NextRequest(
        `https://local.test/api/v1/tags/${encodeURIComponent(tag)}/unfollow`,
        { method: 'POST' }
      ),
      { params: Promise.resolve({ tag }) }
    )
    expect(response.status).toBe(expectedStatus)
  })
})
