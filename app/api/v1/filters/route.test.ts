import { NextRequest } from 'next/server'

import { GET as v2ListFilters } from '@/app/api/v2/filters/route'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

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

describe('/api/v1/filters', () => {
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

  const jsonRequest = (init?: { method?: string; body?: object }) =>
    new NextRequest('https://llun.test/api/v1/filters', {
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

    const response = await GET(jsonRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(401)
  })

  it('creates a single-keyword v2 filter from a v1 POST and returns the v1 view', async () => {
    const response = await POST(
      jsonRequest({
        method: 'POST',
        body: {
          phrase: 'spoilers',
          context: ['home', 'public'],
          irreversible: true,
          whole_word: true,
          expires_in: 3600
        }
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    const created = await response.json()
    expect(created).toMatchObject({
      phrase: 'spoilers',
      context: ['home', 'public'],
      irreversible: true,
      whole_word: true
    })
    expect(created.expires_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )

    // The backing storage is one v2 filter with exactly one keyword, and the
    // v1 id addresses that KEYWORD.
    const v2Response = await v2ListFilters(jsonRequest(), {
      params: Promise.resolve({})
    })
    expect(v2Response.status).toBe(200)
    const v2Filters = await v2Response.json()
    const backing = v2Filters.find(
      (filter: { title: string }) => filter.title === 'spoilers'
    )
    expect(backing).toBeTruthy()
    expect(backing.filter_action).toBe('hide')
    expect(backing.context).toEqual(['home', 'public'])
    expect(backing.keywords).toHaveLength(1)
    expect(backing.keywords[0].id).toBe(created.id)
    expect(backing.keywords[0].keyword).toBe('spoilers')
    expect(backing.keywords[0].whole_word).toBe(true)
  })

  it('accepts a form-encoded POST body with repeated context[] params', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/filters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: 'https://llun.test',
          Referer: 'https://llun.test/'
        },
        body: new URLSearchParams([
          ['phrase', 'form-taboo'],
          ['context[]', 'home'],
          ['context[]', 'notifications'],
          ['whole_word', 'true']
        ]).toString()
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const created = await response.json()
    expect(created).toMatchObject({
      phrase: 'form-taboo',
      context: ['home', 'notifications'],
      irreversible: false,
      whole_word: true
    })
    expect(created.expires_at).toBeNull()
  })

  it('lists one v1 row per keyword of a multi-keyword v2 filter', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'Multi',
      context: ['thread'],
      filterAction: 'hide',
      expiresAt: null,
      keywords: [
        { keyword: 'multi-first', wholeWord: false },
        { keyword: 'multi-second', wholeWord: true }
      ]
    })

    const response = await GET(jsonRequest(), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const rows: {
      id: string
      phrase: string
      context: string[]
      irreversible: boolean
      whole_word: boolean
    }[] = await response.json()

    const keywords = await database.getFilterKeywords({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    expect(keywords).toHaveLength(2)
    for (const keyword of keywords ?? []) {
      const row = rows.find((entry) => entry.id === keyword.id)
      expect(row).toMatchObject({
        phrase: keyword.keyword,
        context: ['thread'],
        irreversible: true,
        whole_word: keyword.wholeWord
      })
    }
  })

  it.each([
    {
      description: 'returns 422 without a phrase',
      body: { context: ['home'] }
    },
    { description: 'returns 422 without a context', body: { phrase: 'taboo' } }
  ])('$description', async ({ body }) => {
    const response = await POST(jsonRequest({ method: 'POST', body }), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(422)
  })
})
