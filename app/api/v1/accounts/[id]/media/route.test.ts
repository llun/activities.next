import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { Attachment } from '@/lib/types/domain/attachment'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = vi.fn()
const mockStoredToken = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => () => ({
    where: () => ({
      first: () => mockStoredToken()
    })
  })
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const PUBLIC_MEDIA_URL = 'https://media.test/account-public.jpg'
const FOLLOWERS_MEDIA_URL = 'https://media.test/account-followers.jpg'
const DIRECT_MEDIA_URL = 'https://media.test/account-direct.jpg'

const createRequest = (query = '') =>
  new NextRequest(
    `https://llun.test/api/v1/accounts/${urlToId(ACTOR1_ID)}/media${query}`,
    { method: 'GET' }
  )

const mediaUrls = async (response: Response) => {
  const data = (await response.json()) as Attachment[]
  return data.map((attachment) => attachment.url)
}

describe('GET /api/v1/accounts/:id/media', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database

    const publicStatusId = `${ACTOR1_ID}/statuses/media-public`
    const followersStatusId = `${ACTOR1_ID}/statuses/media-followers`
    // Addressed to a third actor, so the signed-in non-follower below is not a
    // recipient of it.
    const directStatusId = `${ACTOR1_ID}/statuses/media-direct`

    await database.createNote({
      id: publicStatusId,
      url: publicStatusId,
      actorId: ACTOR1_ID,
      text: 'Media public',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createNote({
      id: followersStatusId,
      url: followersStatusId,
      actorId: ACTOR1_ID,
      text: 'Media followers only',
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })
    await database.createNote({
      id: directStatusId,
      url: directStatusId,
      actorId: ACTOR1_ID,
      text: 'Media direct',
      to: [ACTOR2_ID],
      cc: []
    })

    for (const [statusId, url] of [
      [publicStatusId, PUBLIC_MEDIA_URL],
      [followersStatusId, FOLLOWERS_MEDIA_URL],
      [directStatusId, DIRECT_MEDIA_URL]
    ]) {
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/jpeg',
        url,
        width: 400,
        height: 300
      })
    }
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue(null)
  })

  it('clamps an out-of-range limit instead of rejecting the request', async () => {
    const response = await GET(createRequest('?limit=0'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)
    expect(await mediaUrls(response)).toHaveLength(1)
  })

  // This endpoint backs the profile page's Media tab "Load more". Serving it
  // unscoped handed every caller the attachments of followers-only posts and
  // direct messages, with no session required at all.
  it('serves only publicly readable attachments to an anonymous caller', async () => {
    const response = await GET(createRequest('?limit=50'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)
    const urls = await mediaUrls(response)
    expect(urls).toContain(PUBLIC_MEDIA_URL)
    expect(urls).not.toContain(FOLLOWERS_MEDIA_URL)
    expect(urls).not.toContain(DIRECT_MEDIA_URL)
  })

  it('withholds followers-only attachments from a signed-in non-follower', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    const response = await GET(createRequest('?limit=50'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)
    const urls = await mediaUrls(response)
    expect(urls).toContain(PUBLIC_MEDIA_URL)
    expect(urls).not.toContain(FOLLOWERS_MEDIA_URL)
    // ACTOR2 is the addressee of the direct status, so this one it may read.
    expect(urls).toContain(DIRECT_MEDIA_URL)
  })

  // `read:statuses` is a scope a client may legally hold on its own, and
  // granted-granular never satisfies a required coarse scope. Without
  // `matchMode: 'any'` the guard demands `read` AND `read:statuses`, so this
  // token 401s instead of being recognised as the owner — which is what the
  // sibling statuses route already gets right.
  it('accepts an OAuth token scoped only to read:statuses', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'read:statuses'
    })

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v1/accounts/${urlToId(ACTOR1_ID)}/media?limit=50`,
        { method: 'GET', headers: { Authorization: 'Bearer read-statuses' } }
      ),
      { params: Promise.resolve({ id: urlToId(ACTOR1_ID) }) }
    )

    expect(response.status).toBe(200)
    expect(await mediaUrls(response)).toContain(FOLLOWERS_MEDIA_URL)
  })

  // The guard's own rejection paths return a bare apiErrorResponse, which
  // carries no CORS headers; a cross-origin caller would see an opaque browser
  // failure rather than the JSON error. `errorResponse` is what restores them.
  it('keeps CORS headers on a guard-rejected response (e.g. suspended actor)', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'read'
    })
    await database.setActorSuspended({
      actorId: ACTOR1_ID,
      suspended: true
    })

    try {
      const response = await GET(
        new NextRequest(
          `https://llun.test/api/v1/accounts/${urlToId(ACTOR1_ID)}/media`,
          { method: 'GET', headers: { Authorization: 'Bearer suspended' } }
        ),
        { params: Promise.resolve({ id: urlToId(ACTOR1_ID) }) }
      )

      expect(response.status).toBe(403)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
    } finally {
      await database.setActorSuspended({
        actorId: ACTOR1_ID,
        suspended: false
      })
    }
  })

  it('serves public media when an expired bearer token is provided (matching Mastodon)', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() - 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'read'
    })

    const response = await GET(
      new NextRequest(
        `https://llun.test/api/v1/accounts/${urlToId(ACTOR1_ID)}/media?limit=50`,
        { method: 'GET', headers: { Authorization: 'Bearer expired' } }
      ),
      { params: Promise.resolve({ id: urlToId(ACTOR1_ID) }) }
    )

    expect(response.status).toBe(200)
    const urls = await mediaUrls(response)
    expect(urls).toContain(PUBLIC_MEDIA_URL)
    expect(urls).not.toContain(FOLLOWERS_MEDIA_URL)
    expect(urls).not.toContain(DIRECT_MEDIA_URL)
  })

  it('serves the owner their own private attachments', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const response = await GET(createRequest('?limit=50'), {
      params: Promise.resolve({ id: urlToId(ACTOR1_ID) })
    })

    expect(response.status).toBe(200)
    const urls = await mediaUrls(response)
    expect(urls).toContain(PUBLIC_MEDIA_URL)
    expect(urls).toContain(FOLLOWERS_MEDIA_URL)
    expect(urls).toContain(DIRECT_MEDIA_URL)
  })
})
