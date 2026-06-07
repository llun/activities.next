import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

import { GET, POST } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => undefined
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({ verifyAccessToken: jest.fn() }))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const getRequest = () =>
  new NextRequest('https://llun.test/api/v1/featured_tags', {
    method: 'GET',
    headers: { host: 'llun.test' }
  })

const postRequest = (body: unknown) =>
  new NextRequest('https://llun.test/api/v1/featured_tags', {
    method: 'POST',
    headers: {
      host: 'llun.test',
      origin: 'https://llun.test',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })

describe('featured_tags collection endpoints', () => {
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
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('features a tag and lists it for the current user', async () => {
    const createResponse = await POST(postRequest({ name: '#Coffee' }), {
      params: Promise.resolve({})
    })
    expect(createResponse.status).toBe(200)
    const created = await createResponse.json()
    expect(created).toMatchObject({
      name: 'Coffee',
      url: 'https://llun.test/@test1/tagged/Coffee',
      statuses_count: '0',
      last_status_at: null
    })

    const listResponse = await GET(getRequest(), {
      params: Promise.resolve({})
    })
    expect(listResponse.status).toBe(200)
    const list = await listResponse.json()
    expect(list.map((tag: { name: string }) => tag.name)).toContain('Coffee')

    const stored = await database.getFeaturedTagByName({
      actorId: ACTOR1_ID,
      name: 'coffee'
    })
    expect(stored).not.toBeNull()
  })

  it('is idempotent when featuring an already-featured tag', async () => {
    const first = await POST(postRequest({ name: 'duplicate' }), {
      params: Promise.resolve({})
    })
    expect(first.status).toBe(200)
    const firstTag = await first.json()

    // Re-featuring the same normalized name (different case) returns the
    // existing entry with 200, matching Mastodon's idempotent create.
    const second = await POST(postRequest({ name: '#Duplicate' }), {
      params: Promise.resolve({})
    })
    expect(second.status).toBe(200)
    const secondTag = await second.json()
    expect(secondTag.id).toBe(firstTag.id)
    expect(secondTag.name).toBe('duplicate')
  })

  it('returns 422 once the per-account featured-tags limit is reached', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    // Feature the Mastodon cap of 10 tags for a fresh actor (Actor2).
    for (let index = 0; index < 10; index += 1) {
      const response = await POST(postRequest({ name: `limit${index}` }), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(200)
    }
    // The 11th is rejected.
    const response = await POST(postRequest({ name: 'overflow' }), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(422)
  })

  it('returns 422 for an invalid hashtag name', async () => {
    const response = await POST(postRequest({ name: 'no spaces!' }), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(422)
  })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(getRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
  })
})
