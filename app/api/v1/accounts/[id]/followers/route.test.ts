import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { getRemoteFollowCollectionPage } from '@/lib/services/mastodon/remoteFollowCollection'
import { seedDatabase } from '@/lib/stub/database'
import { actorPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
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

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: vi.fn()
}))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActorSafe: vi.fn()
}))
vi.mock('@/lib/services/mastodon/remoteFollowCollection', () => ({
  getRemoteFollowCollectionPage: vi.fn()
}))

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
    `https://llun.test/api/v1/accounts/${urlToId(targetId)}/followers${query}`,
    { method: 'GET', headers: { host: 'llun.test' } }
  )

describe('GET /api/v1/accounts/:id/followers', () => {
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
    // Public endpoint: unauthenticated by default.
    mockGetServerSession.mockResolvedValue(null)
  })

  it('returns the accepted followers without authentication', async () => {
    // Actor2 followers: EXTERNAL_ACTOR1 and Actor3 (both accepted, real actors).
    const response = await GET(createRequest(ACTOR2_ID), {
      params: Promise.resolve({ id: urlToId(ACTOR2_ID) })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThanOrEqual(2)
    expect(data[0]).toHaveProperty('id')
    expect(data[0]).toHaveProperty('acct')
  })

  it('emits Mastodon Link pagination headers', async () => {
    const response = await GET(createRequest(ACTOR2_ID, '?limit=1'), {
      params: Promise.resolve({ id: urlToId(ACTOR2_ID) })
    })

    expect(response.status).toBe(200)
    const link = response.headers.get('Link')
    expect(link).toContain('rel="next"')
    expect(link).toContain('max_id=')
    expect(link).toContain('rel="prev"')
    expect(link).toContain('min_id=')
  })

  it('paginates forward with min_id and returns newest-first', async () => {
    // Follow rows are ordered by id desc; the oldest is the last one.
    const allFollows = await database.getFollowers({
      targetActorId: ACTOR2_ID,
      limit: 80
    })
    expect(allFollows.length).toBeGreaterThanOrEqual(2)
    const oldestFollowId = allFollows[allFollows.length - 1].id
    const newestActorId = allFollows[0].actorId

    const response = await GET(
      createRequest(ACTOR2_ID, `?min_id=${oldestFollowId}`),
      { params: Promise.resolve({ id: urlToId(ACTOR2_ID) }) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    // Only the rows newer than the oldest cursor, presented newest-first.
    expect(data.length).toBe(allFollows.length - 1)
    expect(data[0].id).toBe(await actorPublicId(database, newestActorId))
    const link = response.headers.get('Link')
    expect(link).toContain('rel="next"')
    expect(link).toContain('rel="prev"')
  })

  it.each([
    { query: '?limit=100', expectedLimit: 80 },
    { query: '?limit=0', expectedLimit: 1 }
  ])(
    'clamps an out-of-range $query to limit $expectedLimit instead of rejecting it',
    async ({ query, expectedLimit }) => {
      const getFollowersSpy = vi.spyOn(database, 'getFollowers')

      const response = await GET(createRequest(ACTOR2_ID, query), {
        params: Promise.resolve({ id: urlToId(ACTOR2_ID) })
      })

      expect(response.status).toBe(200)
      expect(getFollowersSpy).toHaveBeenCalledWith(
        expect.objectContaining({ limit: expectedLimit })
      )

      getFollowersSpy.mockRestore()
    }
  )

  it('returns 404 for an unknown account', async () => {
    const unknown = 'https://llun.test/users/nope'
    const response = await GET(createRequest(unknown), {
      params: Promise.resolve({ id: urlToId(unknown) })
    })
    expect(response.status).toBe(404)
  })
})

describe('GET /api/v1/accounts/:id/followers for a remote actor', () => {
  const database = getTestSQLDatabase()
  const signingActor = { id: 'https://llun.test/users/__instance__' }
  const nextPageUrl = `${EXTERNAL_ACTOR1}/followers?page=2`
  const prevPageUrl = `${EXTERNAL_ACTOR1}/followers?page=1`

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(getRemoteFollowCollectionPage).mockReset()
    vi.mocked(canFederateWithDomain).mockReset()
    vi.mocked(getFederationSigningActorSafe).mockReset()

    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    vi.mocked(canFederateWithDomain).mockResolvedValue(true)
    vi.mocked(getFederationSigningActorSafe).mockResolvedValue(
      signingActor as never
    )
    vi.mocked(getRemoteFollowCollectionPage).mockResolvedValue({
      status: 'ok',
      page: {
        accounts: await database.getMastodonActorsFromIds({
          ids: [ACTOR2_ID]
        }),
        nextPageUrl,
        prevPageUrl,
        totalItems: 42
      }
    })
  })

  it('serves the remote collection page for a signed-in viewer', async () => {
    const response = await GET(createRequest(EXTERNAL_ACTOR1), {
      params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((account: { uri: string }) => account.uri)).toEqual([
      ACTOR2_ID
    ])
    // Signed by the headless instance actor, never the viewer.
    expect(getRemoteFollowCollectionPage).toHaveBeenCalledWith({
      database,
      actorId: EXTERNAL_ACTOR1,
      field: 'followers',
      signingActor,
      pageUrl: undefined
    })
    // The remote page URLs ride in the Mastodon cursors, so an unmodified
    // client paginates by sending them straight back.
    const link = response.headers.get('Link')
    expect(link).toContain(`max_id=${encodeURIComponent(nextPageUrl)}`)
    expect(link).toContain('rel="next"')
    expect(link).toContain(`min_id=${encodeURIComponent(prevPageUrl)}`)
    expect(link).toContain('rel="prev"')
  })

  it.each([
    { cursor: 'max_id', pageUrl: nextPageUrl },
    { cursor: 'min_id', pageUrl: prevPageUrl }
  ])(
    'forwards a $cursor cursor naming a page of the collection',
    async ({ cursor, pageUrl }) => {
      const response = await GET(
        createRequest(
          EXTERNAL_ACTOR1,
          `?${cursor}=${encodeURIComponent(pageUrl)}`
        ),
        { params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) }) }
      )

      expect(response.status).toBe(200)
      expect(getRemoteFollowCollectionPage).toHaveBeenCalledWith(
        expect.objectContaining({ pageUrl })
      )
    }
  )

  it('answers 400 when the service refuses the cursor as a page of another collection', async () => {
    vi.mocked(getRemoteFollowCollectionPage).mockResolvedValue({
      status: 'invalid-page'
    })

    const response = await GET(
      createRequest(
        EXTERNAL_ACTOR1,
        `?max_id=${encodeURIComponent(`${EXTERNAL_ACTOR1}/following?page=2`)}`
      ),
      { params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) }) }
    )

    expect(response.status).toBe(400)
  })

  it('serves the local rows to an anonymous caller without any remote fetch', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await GET(createRequest(EXTERNAL_ACTOR1), {
      params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
    })

    expect(response.status).toBe(200)
    expect(getRemoteFollowCollectionPage).not.toHaveBeenCalled()
  })

  it.each([
    {
      description: 'the remote publishes no page (hidden collection)',
      arrange: () =>
        vi.mocked(getRemoteFollowCollectionPage).mockResolvedValue({
          status: 'unavailable'
        })
    },
    {
      description: 'the remote read throws',
      arrange: () =>
        vi
          .mocked(getRemoteFollowCollectionPage)
          .mockRejectedValue(new Error('unreachable'))
    }
  ])('falls back to the local rows when $description', async ({ arrange }) => {
    arrange()

    const response = await GET(createRequest(EXTERNAL_ACTOR1), {
      params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    // The seed's local follower row for EXTERNAL_ACTOR1 (actor1), not the
    // mocked remote page (actor2).
    expect(data.map((account: { uri: string }) => account.uri)).toEqual([
      ACTOR1_ID
    ])
  })

  it('serves the local rows for a blocked domain without fetching it', async () => {
    vi.mocked(canFederateWithDomain).mockResolvedValue(false)

    const response = await GET(createRequest(EXTERNAL_ACTOR1), {
      params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) })
    })

    expect(response.status).toBe(200)
    expect(getRemoteFollowCollectionPage).not.toHaveBeenCalled()
  })

  it('ignores a remote page cursor on the local fallback path', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const getLocal = vi.spyOn(database, 'getFollowers')

    const response = await GET(
      createRequest(
        EXTERNAL_ACTOR1,
        `?max_id=${encodeURIComponent(nextPageUrl)}`
      ),
      { params: Promise.resolve({ id: urlToId(EXTERNAL_ACTOR1) }) }
    )

    expect(response.status).toBe(200)
    expect(getLocal).toHaveBeenCalledWith(
      expect.objectContaining({ maxId: undefined })
    )
    getLocal.mockRestore()
  })
})
