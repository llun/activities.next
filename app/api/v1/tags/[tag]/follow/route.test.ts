import { NextRequest } from 'next/server'

import { POST } from './route'

const mockDatabase = {
  followTag: vi.fn(),
  getTagDailyHistory: vi.fn()
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

describe('POST /api/v1/tags/:tag/follow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.followTag.mockResolvedValue({
      id: 'followed-tag-1',
      actorId: mockCurrentActor.id,
      name: 'running',
      createdAt: 1000
    })
    mockDatabase.getTagDailyHistory.mockResolvedValue(new Map())
  })

  it('returns the followed Tag entity with its seven-day history', async () => {
    const DAY_MS = 86_400_000
    const todayBucketMs = Math.floor(Date.now() / DAY_MS) * DAY_MS
    mockDatabase.getTagDailyHistory.mockResolvedValue(
      new Map([
        ['running', [{ dayBucketMs: todayBucketMs, uses: 2, accounts: 1 }]]
      ])
    )

    const response = await POST(
      new NextRequest('https://local.test/api/v1/tags/running/follow', {
        method: 'POST'
      }),
      { params: Promise.resolve({ tag: 'running' }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.following).toBe(true)
    expect(body.history).toHaveLength(7)
    expect(body.history[0]).toEqual({
      day: String(todayBucketMs / 1000),
      uses: '2',
      accounts: '1'
    })
    expect(mockDatabase.followTag).toHaveBeenCalledWith({
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
        `https://local.test/api/v1/tags/${encodeURIComponent(tag)}/follow`,
        { method: 'POST' }
      ),
      { params: Promise.resolve({ tag }) }
    )
    expect(response.status).toBe(expectedStatus)
    if (expectedStatus === 400) {
      // A rejected tag must not persist a follow row (guard runs before the write).
      expect(mockDatabase.followTag).not.toHaveBeenCalled()
    }
  })
})
