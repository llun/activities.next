import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
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

vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const createRequest = (query: string) =>
  new NextRequest(`https://llun.test/api/v1/accounts/relationships?${query}`, {
    method: 'GET'
  })

describe('GET /api/v1/accounts/relationships', () => {
  const database = getTestSQLDatabase()

  // publicIds are minted at insert and random per run: read the emitted id back
  // off the stored row rather than hard-coding one.
  const emittedActorId = async (actorId: string) => {
    const publicIds = await database.getActorPublicIds({ actorIds: [actorId] })
    return publicIds.get(actorId) ?? urlToId(actorId)
  }

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
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('accepts id[] and returns relationships in request order', async () => {
    const query = `id[]=${urlToId(ACTOR2_ID)}&id[]=${urlToId(ACTOR3_ID)}`
    const response = await GET(createRequest(query), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(2)
    // Requested in the legacy form, answered with the publicId — and the same
    // value the Account entity emits for that actor.
    const [account2] = await database.getMastodonActorsFromIds({
      ids: [ACTOR2_ID]
    })
    expect(data[0].id).toBe(await emittedActorId(ACTOR2_ID))
    expect(data[0].id).toBe(account2.id)
    expect(data[1].id).toBe(await emittedActorId(ACTOR3_ID))
    expect(data[0]).toHaveProperty('following')
    expect(data[0]).toHaveProperty('muting_expires_at')
  })

  it('accepts the bare repeated id param', async () => {
    const query = `id=${urlToId(ACTOR3_ID)}`
    const response = await GET(createRequest(query), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(await emittedActorId(ACTOR3_ID))
  })

  it('returns an empty array when no ids are provided', async () => {
    const response = await GET(createRequest(''), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  it('returns relationship for remote actor id even when actor row is not stored', async () => {
    const remoteActorId = 'https://remote.social/users/remoteuser'
    await database.createFollow({
      actorId: ACTOR1_ID,
      targetActorId: remoteActorId,
      status: FollowStatus.enum.Requested,
      inbox: `${remoteActorId}/inbox`,
      sharedInbox: 'https://remote.social/inbox'
    })

    const query = `id[]=${encodeURIComponent(remoteActorId)}`
    const response = await GET(createRequest(query), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(urlToId(remoteActorId))
    expect(data[0].requested).toBe(true)
    expect(data[0].following).toBe(false)
  })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(createRequest(`id=${urlToId(ACTOR2_ID)}`), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(401)
  })
})
