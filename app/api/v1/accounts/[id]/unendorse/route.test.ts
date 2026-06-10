import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR3_ID, seedActor3 } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

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

const createRequest = (targetId: string) =>
  new NextRequest(
    `https://llun.test/api/v1/accounts/${urlToId(targetId)}/unendorse`,
    { method: 'POST', headers: { origin: 'https://llun.test' } }
  )

describe('POST /api/v1/accounts/:id/unendorse', () => {
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
  })

  it('removes an existing endorsement and reflects endorsed=false', async () => {
    // Actor3 follows Actor4 in the seed data; create the endorsement first.
    await database.createEndorsement({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR4_ID
    })

    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor3.email }
    })

    const response = await POST(createRequest(ACTOR4_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR4_ID) })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.endorsed).toBe(false)

    const stored = await database.getEndorsement({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR4_ID
    })
    expect(stored).toBeNull()
  })

  it('returns 200 when there is no endorsement to remove', async () => {
    // Actor3 follows Actor4 but no endorsement exists — unendorse is idempotent.
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor3.email }
    })

    const response = await POST(createRequest(ACTOR4_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR4_ID) })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.endorsed).toBe(false)
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
