import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
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

describe('/api/v1/accounts/[id]/collections', () => {
  const database = getTestSQLDatabase()
  const accountId = urlToId(ACTOR1_ID)

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    for (const [title, visibility] of [
      ['Public one', 'public'],
      ['Unlisted one', 'unlisted'],
      ['Private one', 'private']
    ] as const) {
      await database.createCollection({
        actorId: ACTOR1_ID,
        title,
        visibility
      })
    }
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetServerSession.mockResolvedValue(null)
  })

  const request = (query = '') =>
    new NextRequest(
      `https://llun.test/api/v1/accounts/${accountId}/collections${query}`
    )
  const context = { params: Promise.resolve({ id: accountId }) }

  it('lists only discoverable collections for anonymous viewers', async () => {
    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(
      data.collections.map((collection: { title: string }) => collection.title)
    ).toEqual(['Public one'])
    expect(data.collections[0].discoverable).toBe(true)
  })

  it('lists every visibility for the owner', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const response = await GET(request(), context)
    const data = await response.json()
    expect(
      data.collections.map((collection: { title: string }) => collection.title)
    ).toEqual(['Public one', 'Unlisted one', 'Private one'])
  })

  it('honors limit and offset with Link pagination', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const response = await GET(request('?limit=1&offset=1'), context)
    const data = await response.json()
    expect(
      data.collections.map((collection: { title: string }) => collection.title)
    ).toEqual(['Unlisted one'])
    const link = response.headers.get('Link') ?? ''
    expect(link).toContain('limit=1&offset=2>; rel="next"')
    expect(link).toContain('limit=1&offset=0>; rel="prev"')
  })
})
