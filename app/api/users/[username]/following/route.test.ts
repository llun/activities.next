import { NextRequest } from 'next/server'

import { type Actor } from '@/lib/types/domain/actor'

import { GET } from './route'

const mockDatabase = {
  getActorFollowingCount: vi.fn()
}
const mockActor: Actor = {
  id: 'https://example.com/users/test',
  username: 'test',
  domain: 'example.com',
  name: 'Test Actor',
  summary: '',
  followersUrl: 'https://example.com/users/test/followers',
  inboxUrl: 'https://example.com/users/test/inbox',
  sharedInboxUrl: 'https://example.com/inbox',
  followingCount: 4,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1,
  updatedAt: 1,
  publicKey: 'public-key'
}

vi.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
  OnlyLocalUserGuard:
    (
      handle: (...params: unknown[]) => Promise<Response> | Response,
      options?: { allowFederationSigningActor?: boolean }
    ) =>
    (req: NextRequest, query: unknown) => {
      if (!options?.allowFederationSigningActor) {
        return new Response(null, { status: 404 })
      }

      return handle(mockDatabase, mockActor, req, query)
    }
}))

describe('GET /api/users/[username]/following', () => {
  beforeEach(() => {
    mockDatabase.getActorFollowingCount.mockClear()
    mockDatabase.getActorFollowingCount.mockResolvedValue(4)
  })

  it('uses ActivityPub negotiation for following collections', async () => {
    const response = await GET(
      new NextRequest('https://example.com/api/users/test/following', {
        headers: { accept: 'application/activity+json' }
      }),
      { params: Promise.resolve({ username: 'test' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/activity+json'
    )

    const data = await response.json()
    expect(data).toMatchObject({
      id: 'https://example.com/users/test/following',
      type: 'OrderedCollection',
      totalItems: 4
    })
  })
})
