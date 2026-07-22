import { NextRequest } from 'next/server'

import { Status, StatusType } from '@/lib/types/domain/status'

import { GET } from './route'

const mockDatabase = {
  getBlockRelations: vi.fn(),
  getFeaturedTagByName: vi.fn(),
  getMuteRelations: vi.fn(),
  getStatusesByHashtag: vi.fn(),
  getTagDailyHistory: vi.fn(),
  isFollowingTag: vi.fn(),
  getActorDomainBlocks: vi.fn(async () => []),
  getModerationStatesForActors: vi.fn(async () => new Map())
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'local.test' })
}))

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OptionalOAuthGuard:
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

const status = {
  id: 'https://local.test/users/alice/statuses/1',
  actorId: 'https://local.test/users/alice',
  type: StatusType.enum.Note
} as Status

describe('GET /api/v1/tags/:tag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatabase.getBlockRelations.mockResolvedValue([])
    mockDatabase.getFeaturedTagByName.mockResolvedValue({
      id: 'featured-1',
      name: 'running'
    })
    mockDatabase.getMuteRelations.mockResolvedValue([])
    mockDatabase.getStatusesByHashtag.mockResolvedValue([status])
    mockDatabase.getTagDailyHistory.mockResolvedValue(new Map())
    mockDatabase.isFollowingTag.mockResolvedValue(true)
  })

  it('returns the Mastodon Tag entity by default with following and featuring flags', async () => {
    const response = await GET(
      new NextRequest('https://local.test/api/v1/tags/running'),
      { params: Promise.resolve({ tag: 'running' }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.name).toBe('running')
    expect(body.following).toBe(true)
    expect(body.featuring).toBe(true)
    expect(mockDatabase.isFollowingTag).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      name: 'running'
    })
    expect(mockDatabase.getFeaturedTagByName).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      name: 'running'
    })
  })

  it('returns the in-app timeline payload for format=activities_next', async () => {
    const response = await GET(
      new NextRequest(
        'https://local.test/api/v1/tags/running?format=activities_next'
      ),
      { params: Promise.resolve({ tag: 'running' }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body.statuses)).toBe(true)
    expect(mockDatabase.getStatusesByHashtag).toHaveBeenCalled()
  })

  it('includes the seven-day usage history in the Tag entity', async () => {
    const DAY_MS = 86_400_000
    const todayBucketMs = Math.floor(Date.now() / DAY_MS) * DAY_MS
    mockDatabase.getTagDailyHistory.mockResolvedValue(
      new Map([
        ['running', [{ dayBucketMs: todayBucketMs, uses: 3, accounts: 2 }]]
      ])
    )

    const response = await GET(
      new NextRequest('https://local.test/api/v1/tags/running'),
      { params: Promise.resolve({ tag: 'running' }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.history).toHaveLength(7)
    expect(body.history[0]).toEqual({
      day: String(todayBucketMs / 1000),
      uses: '3',
      accounts: '2'
    })
    expect(body.history[1]).toEqual({
      day: String((todayBucketMs - DAY_MS) / 1000),
      uses: '0',
      accounts: '0'
    })
  })

  it.each([
    {
      description: 'accepts a unicode hashtag name',
      tag: 'こんにちは',
      expectedStatus: 200
    },
    {
      description: 'accepts an all-numeric hashtag name',
      tag: '2026',
      expectedStatus: 200
    },
    {
      description: 'rejects a name containing spaces',
      tag: 'not a tag',
      expectedStatus: 400
    }
  ])('$description', async ({ tag, expectedStatus }) => {
    const response = await GET(
      new NextRequest(
        `https://local.test/api/v1/tags/${encodeURIComponent(tag)}`
      ),
      { params: Promise.resolve({ tag }) }
    )
    expect(response.status).toBe(expectedStatus)
  })

  it('accepts a unicode tag whose percent-encoded length exceeds 255', async () => {
    // 30 Japanese chars → 270 percent-encoded chars: over the decoded 255 limit
    // but a valid short name. The raw param cap must not reject it before
    // normalizeHashtagParam decodes it.
    const name = 'あ'.repeat(30)
    const encoded = encodeURIComponent(name)
    expect(encoded.length).toBeGreaterThan(255)
    const response = await GET(
      new NextRequest(`https://local.test/api/v1/tags/${encoded}`),
      { params: Promise.resolve({ tag: encoded }) }
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.name).toBe(name)
  })
})
