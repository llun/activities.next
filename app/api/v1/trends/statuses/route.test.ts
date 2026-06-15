import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
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
  cookies: vi.fn().mockImplementation(() =>
    Promise.resolve({
      get: () => undefined
    })
  )
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

const FIRST_ACTOR_ID = 'https://llun.test/users/first'
const SECOND_ACTOR_ID = 'https://llun.test/users/second'
const THIRD_ACTOR_ID = 'https://llun.test/users/third'

const FIRST_STATUS_ID = `${FIRST_ACTOR_ID}/statuses/a`
const SECOND_STATUS_ID = `${SECOND_ACTOR_ID}/statuses/b`
const QUIET_STATUS_ID = `${FIRST_ACTOR_ID}/statuses/quiet`

describe('GET /api/v1/trends/statuses', () => {
  const database = getTestSQLDatabase()

  const createActor = (id: string, username: string) =>
    database.createActor({
      actorId: id,
      username,
      domain: 'llun.test',
      inboxUrl: `${id}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      followersUrl: `${id}/followers`,
      publicKey: 'public-key',
      privateKey: 'private-key',
      createdAt: 1
    })

  const createPublicNote = ({
    actorId,
    id,
    createdAt
  }: {
    actorId: string
    id: string
    createdAt: number
  }) =>
    database.createNote({
      id,
      url: id,
      actorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Trending candidate',
      createdAt
    })

  beforeAll(async () => {
    await database.migrate()
    await createActor(FIRST_ACTOR_ID, 'first')
    await createActor(SECOND_ACTOR_ID, 'second')
    await createActor(THIRD_ACTOR_ID, 'third')

    const now = Date.now()
    await createPublicNote({
      actorId: FIRST_ACTOR_ID,
      id: FIRST_STATUS_ID,
      createdAt: now - 3000
    })
    await createPublicNote({
      actorId: SECOND_ACTOR_ID,
      id: SECOND_STATUS_ID,
      createdAt: now - 2000
    })
    // The newest status has no interactions and must stay out of the ranking.
    await createPublicNote({
      actorId: FIRST_ACTOR_ID,
      id: QUIET_STATUS_ID,
      createdAt: now - 1000
    })

    // Second status: two likes + one boost → score 4.
    await database.createLike({
      actorId: FIRST_ACTOR_ID,
      statusId: SECOND_STATUS_ID
    })
    await database.createLike({
      actorId: THIRD_ACTOR_ID,
      statusId: SECOND_STATUS_ID
    })
    await database.createAnnounce({
      id: `${FIRST_ACTOR_ID}/statuses/boost-b`,
      actorId: FIRST_ACTOR_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      originalStatusId: SECOND_STATUS_ID
    })
    // First status: one like → score 1.
    await database.createLike({
      actorId: SECOND_ACTOR_ID,
      statusId: FIRST_STATUS_ID
    })
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // No session → optional auth resolves currentActor = null (anonymous).
    mockGetServerSession.mockResolvedValue(null)
  })

  const request = (query = '') =>
    new NextRequest(`https://llun.test/api/v1/trends/statuses${query}`)

  it('returns ranked Mastodon status entities for an anonymous request', async () => {
    const response = await GET(request(), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { uri: string }) => status.uri)).toEqual([
      SECOND_STATUS_ID,
      FIRST_STATUS_ID
    ])
    expect(data[0]).toMatchObject({
      id: urlToId(SECOND_STATUS_ID),
      uri: SECOND_STATUS_ID,
      visibility: 'public',
      favourites_count: 2,
      reblogs_count: 1,
      replies_count: 0,
      favourited: false,
      reblogged: false,
      account: expect.objectContaining({ username: 'second' })
    })
    expect(data[1]).toMatchObject({
      id: urlToId(FIRST_STATUS_ID),
      favourites_count: 1,
      reblogs_count: 0,
      account: expect.objectContaining({ username: 'first' })
    })
  })

  it.each([
    {
      description: 'returns only the top status when limit is 1',
      query: '?limit=1',
      expectedUris: [SECOND_STATUS_ID]
    },
    {
      description: 'falls back to the default limit for a non-integer limit',
      query: '?limit=garbage',
      expectedUris: [SECOND_STATUS_ID, FIRST_STATUS_ID]
    },
    {
      description: 'falls back to the default limit for a negative limit',
      query: '?limit=-5',
      expectedUris: [SECOND_STATUS_ID, FIRST_STATUS_ID]
    },
    {
      description: 'falls back to the first page for a non-integer offset',
      query: '?offset=garbage',
      expectedUris: [SECOND_STATUS_ID, FIRST_STATUS_ID]
    },
    {
      description: 'skips the top status when offset is 1',
      query: '?offset=1',
      expectedUris: [FIRST_STATUS_ID]
    }
  ])('$description', async ({ query, expectedUris }) => {
    const response = await GET(request(query), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((status: { uri: string }) => status.uri)).toEqual(
      expectedUris
    )
  })
})
