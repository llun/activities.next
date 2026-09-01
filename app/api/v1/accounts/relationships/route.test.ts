import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { FollowStatus } from '@/lib/types/domain/follow'
import { generatePublicId } from '@/lib/utils/publicId'
import { urlToId } from '@/lib/utils/urlToId'

import { GET, MAX_BATCH_RELATIONSHIPS } from './route'

// Partial mock so getRelationship's default is the REAL implementation
// (`vi.fn(actual.getRelationship)`) — every test below runs real behaviour —
// while the "one failing id drops" test can queue a single rejection with
// `mockRejectedValueOnce`, after which calls fall back to the real impl. Read
// through the STATIC import above, not vi.importMock: the factory awaits
// importOriginal, so vi.importMock would hand back the original module instead
// of this mock (per AGENTS.md, Testing Guidelines).
vi.mock('@/lib/services/accounts/relationship', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/services/accounts/relationship')
    >()
  return { ...actual, getRelationship: vi.fn(actual.getRelationship) }
})

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

  // An id that resolves to something that is not an actor URI is dropped by the
  // isResolvedActorUri filter on the resolver OUTPUT, rather than reaching
  // getRelationship with a non-id. A publicId-shaped value with no row resolves
  // to the bare uuid, which is not a URI.
  it('drops an id that resolves to a non-actor URI', async () => {
    const response = await GET(createRequest(`id[]=${generatePublicId()}`), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  // Characterization test pinning the LIVE falsy guard: idToUrl returns '' for a
  // bad apurl_ value, and the `!targetActorId` guard drops it. This is not dead
  // code — removing that guard would let '' reach getRelationship.
  it('drops a bad apurl_ id via the empty-string falsy guard', async () => {
    const response = await GET(createRequest('id[]=apurl_not-valid-base64!!'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  it('deduplicates repeated ids', async () => {
    const id = urlToId(ACTOR2_ID)
    const response = await GET(createRequest(`id[]=${id}&id[]=${id}`), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toHaveLength(1)
  })

  it('caps the batch at MAX_BATCH_RELATIONSHIPS distinct ids', async () => {
    const query = Array.from(
      { length: MAX_BATCH_RELATIONSHIPS + 5 },
      (_unused, index) =>
        `id[]=${encodeURIComponent(`https://remote.test/users/u${index}`)}`
    ).join('&')

    const response = await GET(createRequest(query), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toHaveLength(MAX_BATCH_RELATIONSHIPS)
  })

  // Awaiting getRelationship inside the try is what makes the catch reachable;
  // one failing id is dropped rather than rejecting the whole Promise.all.
  it('drops a single failing id instead of failing the request', async () => {
    vi.mocked(getRelationship).mockRejectedValueOnce(new Error('boom'))

    const query = `id[]=${urlToId(ACTOR2_ID)}&id[]=${urlToId(ACTOR3_ID)}`
    const response = await GET(createRequest(query), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(await emittedActorId(ACTOR3_ID))
  })
})
