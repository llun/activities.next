import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { TEST_SHARED_INBOX, seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { FollowStatus } from '@/lib/types/domain/follow'
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

const createRequest = (query: string) =>
  new NextRequest(
    `https://llun.test/api/v1/accounts/familiar_followers?${query}`,
    { method: 'GET' }
  )

describe('GET /api/v1/accounts/familiar_followers', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    // Triad: Actor1 follows Actor3, and Actor3 already follows Actor2 in the
    // seed. So Actor3 is a familiar follower of Actor2 from Actor1's view.
    await database.createFollow({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR3_ID,
      inbox: `${ACTOR3_ID}/inbox`,
      sharedInbox: TEST_SHARED_INBOX,
      status: FollowStatus.enum.Accepted
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
      user: { email: seedActor1.email }
    })
  })

  it('returns the mutual followers the current user follows', async () => {
    // Actor3 follows Actor2 and Actor1 follows Actor3, so Actor3 is a familiar
    // follower of Actor2 from Actor1's perspective.
    const response = await GET(createRequest(`id[]=${urlToId(ACTOR2_ID)}`), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(urlToId(ACTOR2_ID))
    const accountIds = data[0].accounts.map((a: { id: string }) => a.id)
    expect(accountIds).toContain(urlToId(ACTOR3_ID))
    // The current user is never listed as their own familiar follower.
    expect(accountIds).not.toContain(urlToId(ACTOR1_ID))
  })

  it('returns an entry with empty accounts when there are no mutuals', async () => {
    // Actor3's only follower is Actor1 (the current user), who is excluded, so
    // there are no familiar followers.
    const response = await GET(createRequest(`id[]=${urlToId(ACTOR3_ID)}`), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(urlToId(ACTOR3_ID))
    expect(data[0].accounts).toEqual([])
  })

  it('returns {id, accounts: []} for an unknown account id', async () => {
    const unknown = urlToId('https://llun.test/users/ghost')
    const response = await GET(createRequest(`id[]=${unknown}`), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual([{ id: unknown, accounts: [] }])
  })

  it('returns an empty array when no ids are provided', async () => {
    const response = await GET(createRequest(''), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(createRequest(`id=${urlToId(ACTOR4_ID)}`), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(401)
  })
})
