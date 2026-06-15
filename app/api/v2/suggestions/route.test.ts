import { NextRequest } from 'next/server'

import { DELETE } from '@/app/api/v1/suggestions/[account_id]/route'
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
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('/api/v2/suggestions', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    // Friends-of-friends graph for actor1 on top of the base seed: actor1
    // follows actor2 and actor3; actor2 follows actor4 and actor5; actor3
    // already follows actor4 (seedDatabase). Candidates for actor1 are
    // therefore actor4 (2 mutuals) then actor5 (1 mutual).
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
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const createRequest = (query = '') =>
    new NextRequest(`https://llun.test/api/v2/suggestions${query}`)

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(401)
  })

  it('returns friends-of-friends suggestions ranked by mutual count', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual([
      {
        source: 'past_interactions',
        sources: ['friends_of_friends'],
        account: expect.objectContaining({
          id: urlToId(ACTOR4_ID),
          url: ACTOR4_ID
        })
      },
      {
        source: 'past_interactions',
        sources: ['friends_of_friends'],
        account: expect.objectContaining({
          id: urlToId(ACTOR5_ID),
          url: ACTOR5_ID
        })
      }
    ])
  })

  it.each([
    {
      description: 'returns only the top ranked suggestion when limit is 1',
      query: '?limit=1',
      expectedAccountIds: [urlToId(ACTOR4_ID)]
    },
    {
      description: 'falls back to the default limit for a non-integer limit',
      query: '?limit=garbage',
      expectedAccountIds: [urlToId(ACTOR4_ID), urlToId(ACTOR5_ID)]
    }
  ])('$description', async ({ query, expectedAccountIds }) => {
    const response = await GET(createRequest(query), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(
      data.map((item: { account: { id: string } }) => item.account.id)
    ).toEqual(expectedAccountIds)
  })

  it.each([
    {
      description: 'excludes a candidate the current actor blocks',
      blockActorId: ACTOR1_ID,
      blockTargetActorId: ACTOR4_ID
    },
    {
      description: 'excludes a candidate that blocks the current actor',
      blockActorId: ACTOR4_ID,
      blockTargetActorId: ACTOR1_ID
    }
  ])('$description', async ({ blockActorId, blockTargetActorId }) => {
    await database.createBlock({
      actorId: blockActorId,
      targetActorId: blockTargetActorId,
      uri: `${blockActorId}#blocks/${encodeURIComponent(blockTargetActorId)}`
    })
    try {
      const response = await GET(createRequest(), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(
        data.map((item: { account: { id: string } }) => item.account.id)
      ).toEqual([urlToId(ACTOR5_ID)])
    } finally {
      await database.deleteBlock({
        actorId: blockActorId,
        targetActorId: blockTargetActorId
      })
    }
  })

  it('excludes a candidate the current actor mutes', async () => {
    await database.createMute({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR5_ID,
      notifications: false,
      endsAt: null
    })
    try {
      const response = await GET(createRequest(), {
        params: Promise.resolve({})
      })
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(
        data.map((item: { account: { id: string } }) => item.account.id)
      ).toEqual([urlToId(ACTOR4_ID)])
    } finally {
      await database.deleteMute({
        actorId: ACTOR1_ID,
        targetActorId: ACTOR5_ID
      })
    }
  })

  it('removes a candidate dismissed through the v1 endpoint from later responses', async () => {
    const accountId = urlToId(ACTOR4_ID)
    const deleteResponse = await DELETE(
      new NextRequest(`https://llun.test/api/v1/suggestions/${accountId}`, {
        method: 'DELETE',
        headers: { origin: 'https://llun.test' }
      }),
      { params: Promise.resolve({ account_id: accountId }) }
    )
    expect(deleteResponse.status).toBe(200)
    await expect(deleteResponse.json()).resolves.toEqual({})

    const response = await GET(createRequest(), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(
      data.map((item: { account: { id: string } }) => item.account.id)
    ).toEqual([urlToId(ACTOR5_ID)])
  })
})
