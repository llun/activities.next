import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { GET, POST } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => null
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi
    .fn()
    .mockResolvedValue({ user: { email: 'admin@llun.test' } })
}))

const mockGetAdminFromSession = vi.fn()
vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: () => mockGetAdminFromSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('/api/v2/admin/filters', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAdminFromSession.mockResolvedValue({
      id: 'admin',
      email: 'admin@llun.test'
    })
  })

  const baseRequest = (init?: { method?: string; body?: object }) =>
    new NextRequest('https://llun.test/api/v2/admin/filters', {
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

  it('rejects non-admin requests', async () => {
    mockGetAdminFromSession.mockResolvedValue(null)

    const response = await POST(
      baseRequest({
        method: 'POST',
        body: { title: 'Spam', context: ['home'], filter_action: 'hide' }
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(403)
  })

  it('creates a server filter flagged read-only and lists it', async () => {
    const postResponse = await POST(
      baseRequest({
        method: 'POST',
        body: {
          title: 'Spam campaigns',
          context: ['home', 'public'],
          filter_action: 'hide',
          keywords_attributes: [
            { keyword: 'free followers', whole_word: false }
          ]
        }
      }),
      { params: Promise.resolve({}) }
    )
    expect(postResponse.status).toBe(200)
    const created = await postResponse.json()
    expect(created.title).toBe('Spam campaigns')
    expect(created.filter_action).toBe('hide')
    expect(created.server).toBe(true)
    expect(created.keywords).toHaveLength(1)

    const listResponse = await GET(baseRequest(), {
      params: Promise.resolve({})
    })
    expect(listResponse.status).toBe(200)
    const list = await listResponse.json()
    const entry = list.find((item: { id: string }) => item.id === created.id)
    expect(entry).toBeTruthy()
    expect(entry.server).toBe(true)
  })

  it('returns 422 when the body is missing title or context', async () => {
    const response = await POST(
      baseRequest({ method: 'POST', body: { context: ['home'] } }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(422)
  })
})
