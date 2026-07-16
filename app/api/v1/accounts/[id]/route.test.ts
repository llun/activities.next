import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockRecordActorIfNeeded = vi.fn()
vi.mock('@/lib/actions/utils', () => ({
  recordActorIfNeeded: (...params: unknown[]) =>
    mockRecordActorIfNeeded(...params)
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
  new NextRequest(`https://llun.test/api/v1/accounts/${urlToId(targetId)}`, {
    method: 'GET'
  })

describe('GET /api/v1/accounts/:id', () => {
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
    // Public endpoint: no session.
    mockGetServerSession.mockResolvedValue(null)
    mockRecordActorIfNeeded.mockResolvedValue(undefined)
  })

  it('returns the public account without authentication', async () => {
    const response = await GET(createRequest(ACTOR1_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.id).toBe(urlToId(ACTOR1_ID))
    expect(data).toHaveProperty('acct')
    expect(data).toHaveProperty('followers_count')
  })

  it('includes modern account fields on the public account', async () => {
    const response = await GET(createRequest(ACTOR1_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.uri).toBe(ACTOR1_ID)
    expect(data.roles).toEqual([])
    expect(data.indexable).toBe(false)
    expect(data.hide_collections).toBeNull()
    expect(data.source.attribution_domains).toEqual([])
  })

  it('returns 404 for an unknown account', async () => {
    const unknown = 'https://llun.test/users/nope'
    const response = await GET(createRequest(unknown), {
      params: Promise.resolve({ id: urlToId(unknown) })
    })
    expect(response.status).toBe(404)
  })

  it('refreshes known remote actors for authenticated viewers', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const response = await GET(createRequest(EXTERNAL_ACTOR1), {
      params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
    })

    expect(response.status).toBe(200)
    expect(mockRecordActorIfNeeded).toHaveBeenCalledWith({
      actorId: EXTERNAL_ACTOR1,
      database
    })
  })

  it('does not refresh local actors for authenticated viewers', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const response = await GET(createRequest(ACTOR1_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)
    expect(mockRecordActorIfNeeded).not.toHaveBeenCalled()
  })

  it('does not trigger remote fetches for anonymous viewers', async () => {
    const response = await GET(createRequest(EXTERNAL_ACTOR1), {
      params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
    })

    expect(response.status).toBe(200)
    expect(mockRecordActorIfNeeded).not.toHaveBeenCalled()
  })

  it('serves the stored account when the remote refresh fails', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockRecordActorIfNeeded.mockRejectedValue(new Error('remote down'))

    const response = await GET(createRequest(EXTERNAL_ACTOR1), {
      params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.id).toBe(urlToId(EXTERNAL_ACTOR1))
  })
})
