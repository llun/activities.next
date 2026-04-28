import { NextRequest } from 'next/server'

import { type Actor } from '@/lib/types/domain/actor'

import { GET } from './route'

const mockDatabase = {
  getActorStatuses: jest.fn()
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
  followingCount: 0,
  followersCount: 0,
  statusCount: 3,
  lastStatusAt: null,
  createdAt: 1,
  updatedAt: 1,
  publicKey: 'public-key'
}

jest.mock('@/lib/services/guards/OnlyLocalUserGuard', () => ({
  OnlyLocalUserGuard:
    (handle: (...params: unknown[]) => Promise<Response> | Response) =>
    (req: NextRequest, query: unknown) =>
      handle(mockDatabase, mockActor, req, query)
}))

describe('GET /api/users/[username]/outbox', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('negotiates collection responses with the shared ActivityPub helper', async () => {
    const response = await GET(
      new NextRequest('https://example.com/api/users/test/outbox', {
        headers: {
          accept:
            'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
        }
      }),
      { params: Promise.resolve({ username: 'test' }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(
      'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
    )

    const data = await response.json()
    expect(data).toMatchObject({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: 'https://example.com/users/test/outbox',
      type: 'OrderedCollection',
      totalItems: 3,
      first: 'https://example.com/users/test/outbox?page=true'
    })
  })
})
