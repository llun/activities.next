import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { type Actor } from '@/lib/types/domain/actor'

import { GET } from './route'

const ACTOR_ID = 'https://example.com/users/test'
const mockActor: Actor = {
  id: ACTOR_ID,
  username: 'test',
  domain: 'example.com',
  name: 'Test Actor',
  summary: '',
  followersUrl: `${ACTOR_ID}/followers`,
  inboxUrl: `${ACTOR_ID}/inbox`,
  sharedInboxUrl: 'https://example.com/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1,
  updatedAt: 1,
  publicKey: 'public-key'
}

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null

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

const createRequest = () =>
  new NextRequest('https://example.com/api/users/test/collections/tags', {
    headers: {
      accept:
        'application/ld+json; profile="https://www.w3.org/ns/activitystreams"'
    }
  })

describe('GET /api/users/[username]/collections/tags', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  it('returns an empty OrderedCollection when nothing is featured', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ username: 'test' })
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${ACTOR_ID}/collections/tags`,
      type: 'OrderedCollection',
      totalItems: 0,
      orderedItems: []
    })
  })

  it('reflects the actor featured tags as AP Hashtag items', async () => {
    await database.createFeaturedTag({ actorId: ACTOR_ID, name: '#Running' })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ username: 'test' })
    })
    const data = await response.json()
    expect(data.totalItems).toBe(1)
    expect(data.orderedItems).toEqual([
      {
        type: 'Hashtag',
        href: 'https://example.com/tags/running',
        name: '#Running'
      }
    ])
  })
})
