import { NextRequest } from 'next/server'

import { GET } from './route'

const mockDatabase = {
  getFollowedTags: vi.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'local.test' })
}))

vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuardAnyScope:
    (
      _scopes: unknown,
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

describe('GET /api/v1/followed_tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forwards min_id and emits next and prev Link headers on a full page', async () => {
    mockDatabase.getFollowedTags.mockResolvedValue([
      {
        id: 'tag-2',
        actorId: mockCurrentActor.id,
        name: 'running',
        createdAt: 2000
      },
      {
        id: 'tag-1',
        actorId: mockCurrentActor.id,
        name: 'cycling',
        createdAt: 1000
      }
    ])

    const response = await GET(
      new NextRequest(
        'https://local.test/api/v1/followed_tags?limit=2&min_id=tag-0'
      ),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.getFollowedTags).toHaveBeenCalledWith({
      actorId: mockCurrentActor.id,
      limit: 2,
      maxId: null,
      minId: 'tag-0',
      sinceId: null
    })
    const link = response.headers.get('Link')
    expect(link).toContain(
      '<https://local.test/api/v1/followed_tags?limit=2&max_id=tag-1>; rel="next"'
    )
    expect(link).toContain(
      '<https://local.test/api/v1/followed_tags?limit=2&min_id=tag-2>; rel="prev"'
    )
  })

  it('emits only the prev link on a short page', async () => {
    mockDatabase.getFollowedTags.mockResolvedValue([
      {
        id: 'tag-1',
        actorId: mockCurrentActor.id,
        name: 'cycling',
        createdAt: 1000
      }
    ])

    const response = await GET(
      new NextRequest('https://local.test/api/v1/followed_tags?limit=2'),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const link = response.headers.get('Link')
    expect(link).not.toContain('rel="next"')
    expect(link).toContain('min_id=tag-1>; rel="prev"')
  })

  it('emits no Link header when the actor follows no tags', async () => {
    mockDatabase.getFollowedTags.mockResolvedValue([])

    const response = await GET(
      new NextRequest('https://local.test/api/v1/followed_tags'),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Link')).toBeNull()
  })
})
