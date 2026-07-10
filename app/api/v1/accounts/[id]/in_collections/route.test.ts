import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() =>
    Promise.resolve({
      get: () => undefined
    })
  )
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  }),
  getBaseURL: () => 'https://llun.test'
}))

describe('/api/v1/accounts/[id]/in_collections', () => {
  const database = getTestSQLDatabase()
  const targetAccountId = urlToId(ACTOR2_ID)

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    // actor1's PUBLIC collection featuring actor2 with consent → visible to
    // any authenticated caller.
    const publicApproved = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Public approved',
      visibility: 'public'
    })
    await database.addCollectionMembers({
      id: publicApproved.id,
      actorId: ACTOR1_ID,
      targetActorIds: [ACTOR2_ID]
    })
    await database.setCollectionMemberState({
      id: publicApproved.id,
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID,
      state: 'approved'
    })

    // actor1's PRIVATE collection featuring actor2 (pending) → only actor1
    // (the owner) may see it here.
    const privatePending = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Private pending',
      visibility: 'private'
    })
    await database.addCollectionMembers({
      id: privatePending.id,
      actorId: ACTOR1_ID,
      targetActorIds: [ACTOR2_ID]
    })

    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const request = () =>
    new NextRequest(
      `https://llun.test/api/v1/accounts/${targetAccountId}/in_collections`
    )
  const context = { params: Promise.resolve({ id: targetAccountId }) }

  it.each([
    {
      caller: 'the featured member',
      email: () => seedActor2.email,
      expected: ['Public approved']
    },
    {
      caller: 'the curating owner',
      email: () => seedActor1.email,
      expected: ['Private pending', 'Public approved']
    }
  ])('shows $caller the collections $expected', async ({ email, expected }) => {
    mockGetServerSession.mockResolvedValue({ user: { email: email() } })
    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(
      data.collections
        .map((collection: { title: string }) => collection.title)
        .sort()
    ).toEqual(expected)
  })

  it('rejects anonymous callers', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(request(), context)
    expect(response.status).toBe(401)
  })

  it('emits offset Link headers matching /accounts/:id/collections', async () => {
    // Shares the offset-paging contract with the sibling /collections route via
    // buildOffsetPaginationLinkHeader; the owner sees both collections here.
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v1/accounts/${targetAccountId}/in_collections?limit=1&offset=1`
      ),
      context
    )
    expect(response.status).toBe(200)
    const link = response.headers.get('Link') ?? ''
    expect(link).toContain(
      `/api/v1/accounts/${targetAccountId}/in_collections?limit=1&offset=2>; rel="next"`
    )
    expect(link).toContain('limit=1&offset=0>; rel="prev"')
  })
})
