import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID, seedActor3 } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

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

const createRequest = (query = '') =>
  new NextRequest(`https://llun.test/api/v1/endorsements${query}`, {
    method: 'GET',
    headers: { host: 'llun.test' }
  })

describe('GET /api/v1/endorsements', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    await database.createEndorsement({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR4_ID
    })
    await database.createEndorsement({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR2_ID
    })
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor3.email }
    })
  })

  it('returns the current user endorsed accounts', async () => {
    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.length).toBeGreaterThanOrEqual(2)
    const ids = data.map((account: { id: string }) => account.id)
    expect(ids).toContain(urlToId(ACTOR4_ID))
    expect(ids).toContain(urlToId(ACTOR2_ID))
  })

  it('emits Link pagination headers when limiting', async () => {
    const response = await GET(createRequest('?limit=1'), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const link = response.headers.get('Link')
    expect(link).toContain('rel="next"')
    expect(link).toContain('max_id=')
  })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
  })
})
