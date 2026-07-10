import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { FEATURED_TAGS_LIMIT } from '@/lib/services/mastodon/featureTag'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => undefined
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({ verifyAccessToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const postRequest = (tag: string) =>
  new NextRequest(
    `https://llun.test/api/v1/tags/${encodeURIComponent(tag)}/feature`,
    {
      method: 'POST',
      headers: { host: 'llun.test', origin: 'https://llun.test' }
    }
  )

describe('POST /api/v1/tags/:tag/feature', () => {
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

  it('features the tag and returns the Tag entity with featuring true', async () => {
    const response = await POST(postRequest('Coffee'), {
      params: Promise.resolve({ tag: 'Coffee' })
    })

    expect(response.status).toBe(200)
    const tag = await response.json()
    expect(tag).toEqual({
      name: 'Coffee',
      url: 'https://llun.test/tags/Coffee',
      history: [],
      following: false,
      featuring: true
    })

    const featured = await database.getFeaturedTags({ actorId: ACTOR1_ID })
    expect(featured.map((item) => item.name)).toContain('Coffee')
  })

  it('is idempotent when the tag is already featured', async () => {
    const first = await POST(postRequest('twice'), {
      params: Promise.resolve({ tag: 'twice' })
    })
    expect(first.status).toBe(200)

    const second = await POST(postRequest('twice'), {
      params: Promise.resolve({ tag: 'twice' })
    })
    expect(second.status).toBe(200)
    expect((await second.json()).featuring).toBe(true)

    const featured = await database.getFeaturedTags({ actorId: ACTOR1_ID })
    expect(featured.filter((item) => item.name === 'twice')).toHaveLength(1)
  })

  it('returns 422 once the per-account featured-tags limit is reached', async () => {
    // Use a fresh actor (Actor2) so the cap starts from zero.
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    for (let index = 0; index < FEATURED_TAGS_LIMIT; index += 1) {
      const response = await POST(postRequest(`limit${index}`), {
        params: Promise.resolve({ tag: `limit${index}` })
      })
      expect(response.status).toBe(200)
    }

    const overflow = await POST(postRequest('overflow'), {
      params: Promise.resolve({ tag: 'overflow' })
    })
    expect(overflow.status).toBe(422)
    expect(await overflow.json()).toEqual({
      error: `You can only feature up to ${FEATURED_TAGS_LIMIT} hashtags`
    })
  })

  it('returns 400 for an invalid tag name', async () => {
    const response = await POST(postRequest('nope nope'), {
      params: Promise.resolve({ tag: 'nope nope' })
    })
    expect(response.status).toBe(400)
  })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await POST(postRequest('Coffee'), {
      params: Promise.resolve({ tag: 'Coffee' })
    })
    expect(response.status).toBe(401)
  })
})
