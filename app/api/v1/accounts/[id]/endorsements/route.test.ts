import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { actorPublicId } from '@/lib/stub/publicIds'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { urlToId } from '@/lib/utils/urlToId'

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

vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const createRequest = (targetId: string, query = '') =>
  new NextRequest(
    `https://llun.test/api/v1/accounts/${urlToId(targetId)}/endorsements${query}`,
    { method: 'GET', headers: { host: 'llun.test' } }
  )

describe('GET /api/v1/accounts/:id/endorsements', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    await database.createEndorsement({
      actorId: ACTOR3_ID,
      targetActorId: ACTOR4_ID
    })
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Public endpoint.
    mockGetServerSession.mockResolvedValue(null)
  })

  it('returns the accounts the given account features (no auth required)', async () => {
    const response = await GET(createRequest(ACTOR3_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR3_ID) })
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(await actorPublicId(database, ACTOR4_ID))
    const link = response.headers.get('Link')
    expect(link).toContain('rel="next"')
    expect(link).toContain('max_id=')
  })

  it('returns 404 for an unknown account', async () => {
    const unknown = 'https://llun.test/users/nope'
    const response = await GET(createRequest(unknown), {
      params: Promise.resolve({ id: urlToId(unknown) })
    })
    expect(response.status).toBe(404)
  })

  it('returns 404 to a signed-out caller for a Bluesky account and 200 when signed in', async () => {
    const did = `did:plc:${'e'.repeat(24)}`
    const blueskyId = (await database.upsertBlueskyActor({
      did,
      handle: 'endorsed.bsky.social'
    })) as string
    const publicId = await actorPublicId(database, blueskyId)

    const anonByEncoded = await GET(createRequest(blueskyId), {
      params: Promise.resolve({ id: urlToId(blueskyId) })
    })
    expect(anonByEncoded.status).toBe(404)

    const anonByPublicId = await GET(
      new NextRequest(
        `https://llun.test/api/v1/accounts/${publicId}/endorsements`,
        { method: 'GET', headers: { host: 'llun.test' } }
      ),
      { params: Promise.resolve({ id: publicId }) }
    )
    expect(anonByPublicId.status).toBe(404)

    mockGetServerSession.mockResolvedValueOnce({
      user: { email: seedActor1.email }
    })
    const signedIn = await GET(createRequest(blueskyId), {
      params: Promise.resolve({ id: urlToId(blueskyId) })
    })
    expect(signedIn.status).toBe(200)
    expect(await signedIn.json()).toEqual([])
  })

  it.each([
    ['limit=100', '?limit=100', 80],
    ['limit=0', '?limit=0', 1]
  ])(
    'clamps out-of-range %s instead of rejecting it',
    async (_label, query, expectedLimit) => {
      const getEndorsements = vi.spyOn(database, 'getEndorsements')
      const response = await GET(createRequest(ACTOR3_ID, query), {
        params: Promise.resolve({ id: urlToId(ACTOR3_ID) })
      })
      expect(response.status).toBe(200)
      expect(getEndorsements).toHaveBeenCalledWith(
        expect.objectContaining({ limit: expectedLimit })
      )
    }
  )
})
