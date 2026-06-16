import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID, seedActor3 } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { urlToId } from '@/lib/utils/urlToId'

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

const createRequest = (targetId: string) =>
  new NextRequest(
    `https://llun.test/api/v1/accounts/${urlToId(targetId)}/pin`,
    { method: 'POST', headers: { origin: 'https://llun.test' } }
  )

describe('POST /api/v1/accounts/:id/pin', () => {
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
  })

  it('endorses an account the user follows and reflects endorsed=true', async () => {
    // Actor3 follows Actor4 in the seed data.
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor3.email }
    })

    const response = await POST(createRequest(ACTOR4_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR4_ID) })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.endorsed).toBe(true)

    const stored = await database.getEndorsement({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR4_ID
    })
    expect(stored).not.toBeNull()
  })

  it('rejects endorsing an account the user does not follow with 422', async () => {
    // Actor1 does not follow the local Actor2.
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const response = await POST(createRequest(ACTOR2_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR2_ID) })
    })

    expect(response.status).toBe(422)
    const stored = await database.getEndorsement({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID
    })
    expect(stored).toBeNull()
  })

  it('returns 404 for an unknown account', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor3.email }
    })
    const unknown = 'https://llun.test/users/does-not-exist'

    const response = await POST(createRequest(unknown), {
      params: Promise.resolve({ id: urlToId(unknown) })
    })

    expect(response.status).toBe(404)
  })
})
