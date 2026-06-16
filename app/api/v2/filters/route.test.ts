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
  getDatabase: () => mockDatabase,
  getKnex: () => null
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('/api/v2/filters', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const baseRequest = (init?: { method?: string; body?: object }) =>
    new NextRequest('https://llun.test/api/v2/filters', {
      method: init?.method ?? 'GET',
      headers: init?.body
        ? {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test',
            Referer: 'https://llun.test/'
          }
        : { Origin: 'https://llun.test' },
      body: init?.body ? JSON.stringify(init.body) : undefined
    })

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await GET(baseRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
  })

  it('creates a filter (JSON) and then lists it', async () => {
    const postResponse = await POST(
      baseRequest({
        method: 'POST',
        body: {
          title: 'My Filter',
          context: ['home'],
          filter_action: 'warn',
          expires_in: 3600,
          keywords_attributes: [{ keyword: 'taboo', whole_word: true }]
        }
      }),
      { params: Promise.resolve({}) }
    )
    expect(postResponse.status).toBe(200)
    const created = await postResponse.json()
    expect(created.title).toBe('My Filter')
    expect(created.context).toEqual(['home'])
    expect(created.filter_action).toBe('warn')
    expect(created.keywords).toHaveLength(1)
    expect(created.keywords[0].keyword).toBe('taboo')

    const listResponse = await GET(baseRequest(), {
      params: Promise.resolve({})
    })
    expect(listResponse.status).toBe(200)
    const list = await listResponse.json()
    expect(
      list.find((entry: { id: string }) => entry.id === created.id)
    ).toBeTruthy()
  })

  it('returns 422 when the body is missing title or context', async () => {
    const response = await POST(
      baseRequest({
        method: 'POST',
        body: { context: ['home'] }
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(422)
  })
})
