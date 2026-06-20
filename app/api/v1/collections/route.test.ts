import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { GET, POST } from './route'

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

describe('/api/v1/collections', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const postRequest = (body: unknown) =>
    new NextRequest('https://llun.test/api/v1/collections', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // sameOriginProof requires the Origin to match the base URL for
        // state-changing methods.
        origin: 'https://llun.test'
      },
      body: JSON.stringify(body)
    })

  const context = { params: Promise.resolve({}) }

  it('creates a collection and returns the Mastodon entity', async () => {
    const response = await POST(postRequest({ title: 'Cool people' }), context)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.title).toBe('Cool people')
    expect(data.visibility).toBe('public')
    expect(data.feed_enabled).toBe(true)
    expect(data.size).toBe(0)
    expect(typeof data.id).toBe('string')
  })

  it('rejects a collection without a title', async () => {
    const response = await POST(
      postRequest({ description: 'no title' }),
      context
    )
    expect(response.status).toBe(422)
  })

  it('lists the actor’s collections', async () => {
    await POST(postRequest({ title: 'Another collection' }), context)
    const response = await GET(
      new NextRequest('https://llun.test/api/v1/collections'),
      context
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.length).toBeGreaterThanOrEqual(1)
    expect(
      data.some((c: { title: string }) => c.title === 'Another collection')
    ).toBe(true)
  })
})
