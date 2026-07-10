import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

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
    `https://llun.test/api/v1/tags/${encodeURIComponent(tag)}/unfeature`,
    {
      method: 'POST',
      headers: { host: 'llun.test', origin: 'https://llun.test' }
    }
  )

describe('POST /api/v1/tags/:tag/unfeature', () => {
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

  it('unfeatures a featured tag and returns the Tag entity with featuring false', async () => {
    await database.createFeaturedTag({ actorId: ACTOR1_ID, name: 'Coffee' })

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
      featuring: false
    })
    expect(
      await database.getFeaturedTagByName({
        actorId: ACTOR1_ID,
        name: 'coffee'
      })
    ).toBeNull()
  })

  it('is idempotent when the tag is not featured', async () => {
    const response = await POST(postRequest('neverfeatured'), {
      params: Promise.resolve({ tag: 'neverfeatured' })
    })
    expect(response.status).toBe(200)
    expect((await response.json()).featuring).toBe(false)
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
