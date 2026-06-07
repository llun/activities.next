import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET } from './route'

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

const createRequest = () =>
  new NextRequest('https://llun.test/api/v1/featured_tags/suggestions', {
    method: 'GET',
    headers: { host: 'llun.test' }
  })

describe('GET /api/v1/featured_tags/suggestions', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    // Actor1 uses #suggested (on a public post) and #already (featured).
    await database.createTag({
      statusId: `${ACTOR1_ID}/statuses/post-1`,
      type: 'hashtag',
      name: '#suggested',
      value: 'https://llun.test/tags/suggested'
    })
    await database.createTag({
      statusId: `${ACTOR1_ID}/statuses/post-2`,
      type: 'hashtag',
      name: '#already',
      value: 'https://llun.test/tags/already'
    })
    await database.createFeaturedTag({ actorId: ACTOR1_ID, name: 'already' })
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

  it('suggests used hashtags that are not already featured as Tag[]', async () => {
    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    const data = await response.json()
    const names = data.map((tag: { name: string }) => tag.name)
    expect(names).toContain('suggested')
    expect(names).not.toContain('already')
    expect(data[0]).toMatchObject({
      url: 'https://llun.test/tags/suggested',
      history: []
    })
  })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
  })
})
