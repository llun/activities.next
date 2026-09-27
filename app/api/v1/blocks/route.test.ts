import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

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
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/blocks', () => {
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

  const createdTargets: string[] = []
  const createBlock = async (targetActorId: string) => {
    createdTargets.push(targetActorId)
    await database.createBlock({
      actorId: ACTOR1_ID,
      targetActorId,
      uri: `${ACTOR1_ID}#blocks/${encodeURIComponent(targetActorId)}`
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  afterEach(async () => {
    while (createdTargets.length > 0) {
      const targetActorId = createdTargets.pop()
      if (targetActorId) {
        await database.deleteBlock({ actorId: ACTOR1_ID, targetActorId })
      }
    }
  })

  const createRequest = (query = '') =>
    new NextRequest(`https://llun.test/api/v1/blocks${query}`)

  it('returns Mastodon accounts for blocked actors', async () => {
    await createBlock(ACTOR2_ID)

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toContainEqual(expect.objectContaining({ url: ACTOR2_ID }))
  })

  it('emits a Link header with max_id when the page is full', async () => {
    const remoteA = 'https://remote.test/users/list-block-link-a'
    const remoteB = 'https://remote.test/users/list-block-link-b'
    for (const target of [remoteA, remoteB]) {
      await createBlock(target)
    }

    const response = await GET(createRequest('?limit=1'), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const linkHeader = response.headers.get('Link')
    expect(linkHeader).toContain('rel="next"')
    expect(linkHeader).toContain('max_id=')
  })
})
