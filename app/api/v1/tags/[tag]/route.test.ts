import { NextRequest } from 'next/server'

import { Status, StatusType } from '@/lib/types/domain/status'

import { GET } from './route'

const mockDatabase = {
  getBlockRelations: jest.fn(),
  getMuteRelations: jest.fn(),
  getStatusesByHashtag: jest.fn(),
  isFollowingTag: jest.fn()
}
const mockCurrentActor = {
  id: 'https://local.test/users/me'
}

jest.mock('@/lib/config', () => ({
  getConfig: () => ({ host: 'local.test' })
}))

jest.mock('@/lib/services/guards/OAuthGuard', () => ({
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
  corsErrorResponse: jest.fn()
}))

const status = {
  id: 'https://local.test/users/alice/statuses/1',
  actorId: 'https://local.test/users/alice',
  type: StatusType.enum.Note
} as Status

describe('GET /api/v1/tags/:tag', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDatabase.getBlockRelations.mockResolvedValue([])
    mockDatabase.getMuteRelations.mockResolvedValue([])
    mockDatabase.getStatusesByHashtag.mockResolvedValue([status])
    mockDatabase.isFollowingTag.mockResolvedValue(true)
  })

  it('returns the Mastodon Tag entity by default with the following flag', async () => {
    const response = await GET(
      new NextRequest('https://local.test/api/v1/tags/running'),
      { params: Promise.resolve({ tag: 'running' }) }
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.name).toBe('running')
    expect(body.following).toBe(true)
    expect(mockDatabase.isFollowingTag).toHaveBeenCalledWith({
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
})
