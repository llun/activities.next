import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
import { ACTOR5_ID } from '@/lib/stub/seed/actor5'
import { FollowStatus } from '@/lib/types/domain/follow'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({
  verifyAccessToken: jest.fn()
}))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('/api/v1/suggestions', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    // Same friends-of-friends graph as the v2 route test: actor1 follows
    // actor2 and actor3; actor2 follows actor4 and actor5; actor3 already
    // follows actor4 (seedDatabase). Candidates for actor1 are actor4
    // (2 mutuals) then actor5 (1 mutual).
    const follows: [string, string][] = [
      [ACTOR1_ID, ACTOR2_ID],
      [ACTOR1_ID, ACTOR3_ID],
      [ACTOR2_ID, ACTOR4_ID],
      [ACTOR2_ID, ACTOR5_ID]
    ]
    for (const [actorId, targetActorId] of follows) {
      await database.createFollow({
        actorId,
        targetActorId,
        status: FollowStatus.enum.Accepted,
        inbox: `${actorId}/inbox`,
        sharedInbox: 'https://llun.test/inbox'
      })
    }
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

  const createRequest = (query = '') =>
    new NextRequest(`https://llun.test/api/v1/suggestions${query}`)

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(401)
  })

  it('returns plain ranked accounts without suggestion wrappers', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((account: { id: string }) => account.id)).toEqual([
      urlToId(ACTOR4_ID),
      urlToId(ACTOR5_ID)
    ])
    for (const account of data) {
      // Not wrapped in a Suggestion entity: no `sources` array and no nested
      // `account`. (A top-level `source` key exists on the Account entity
      // itself — its posting defaults object — so assert it is not the
      // Suggestion source string.)
      expect(account).not.toHaveProperty('sources')
      expect(account).not.toHaveProperty('account')
      expect(typeof account.source).not.toBe('string')
    }
  })
})
