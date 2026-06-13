import { NextRequest } from 'next/server'

import { GET as TRENDS_ALIAS_GET } from '@/app/api/v1/trends/route'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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
  cookies: jest.fn().mockImplementation(() =>
    Promise.resolve({
      get: () => undefined
    })
  )
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

const FIRST_ACTOR_ID = 'https://llun.test/users/first'
const SECOND_ACTOR_ID = 'https://llun.test/users/second'

const DAY_MS = 86_400_000

describe('GET /api/v1/trends/tags', () => {
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

  const createTaggedNote = async ({
    actorId,
    id,
    tag,
    createdAt
  }: {
    actorId: string
    id: string
    tag: string
    createdAt: number
  }) => {
    await database.createNote({
      id,
      url: id,
      actorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: `Post about #${tag}`,
      createdAt
    })
    await database.createTag({
      statusId: id,
      type: 'hashtag',
      name: `#${tag}`,
      value: `https://llun.test/tags/${tag.toLowerCase()}`
    })
  }

  beforeAll(async () => {
    await database.migrate()
    await createActor(FIRST_ACTOR_ID, 'first')
    await createActor(SECOND_ACTOR_ID, 'second')

    const now = Date.now()
    // alpha: three public statuses by two actors today.
    await createTaggedNote({
      actorId: FIRST_ACTOR_ID,
      id: `${FIRST_ACTOR_ID}/statuses/1`,
      tag: 'alpha',
      createdAt: now - 1000
    })
    await createTaggedNote({
      actorId: FIRST_ACTOR_ID,
      id: `${FIRST_ACTOR_ID}/statuses/2`,
      tag: 'alpha',
      createdAt: now - 2000
    })
    await createTaggedNote({
      actorId: SECOND_ACTOR_ID,
      id: `${SECOND_ACTOR_ID}/statuses/1`,
      tag: 'alpha',
      createdAt: now - 3000
    })
    // beta: one public status by one actor today.
    await createTaggedNote({
      actorId: FIRST_ACTOR_ID,
      id: `${FIRST_ACTOR_ID}/statuses/3`,
      tag: 'beta',
      createdAt: now - 4000
    })
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    // No session → optional auth resolves currentActor = null (anonymous).
    mockGetServerSession.mockResolvedValue(null)
  })

  const request = (path = '/api/v1/trends/tags', query = '') =>
    new NextRequest(`https://llun.test${path}${query}`)

  // Seven UTC-day buckets newest first; only today carries the seeded counts,
  // every other day is zero-filled. All values are strings per the Mastodon
  // Tag history shape, and `day` is the unix-second start of the UTC day.
  const expectedHistory = (uses: number, accounts: number) => {
    const todayBucketMs = Math.floor(Date.now() / DAY_MS) * DAY_MS
    return Array.from({ length: 7 }, (_, index) => ({
      day: String((todayBucketMs - index * DAY_MS) / 1000),
      uses: String(index === 0 ? uses : 0),
      accounts: String(index === 0 ? accounts : 0)
    }))
  }

  it('returns trending tag entities with zero-filled seven-day history for an anonymous request', async () => {
    const response = await GET(request(), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual([
      {
        name: 'alpha',
        url: 'https://llun.test/tags/alpha',
        following: false,
        history: expectedHistory(3, 2)
      },
      {
        name: 'beta',
        url: 'https://llun.test/tags/beta',
        following: false,
        history: expectedHistory(1, 1)
      }
    ])
  })

  it.each([
    {
      description: 'returns only the top tag when limit is 1',
      query: '?limit=1',
      expectedNames: ['alpha']
    },
    {
      description: 'falls back to the default limit for a non-integer limit',
      query: '?limit=garbage',
      expectedNames: ['alpha', 'beta']
    },
    {
      description: 'falls back to the default limit for a negative limit',
      query: '?limit=-5',
      expectedNames: ['alpha', 'beta']
    },
    {
      description: 'falls back to the first page for a non-integer offset',
      query: '?offset=garbage',
      expectedNames: ['alpha', 'beta']
    },
    {
      description: 'skips the top tag when offset is 1',
      query: '?offset=1',
      expectedNames: ['beta']
    }
  ])('$description', async ({ query, expectedNames }) => {
    const response = await GET(request('/api/v1/trends/tags', query), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.map((tag: { name: string }) => tag.name)).toEqual(expectedNames)
  })

  it('serves the identical body at the deprecated /api/v1/trends alias', async () => {
    const aliasResponse = await TRENDS_ALIAS_GET(request('/api/v1/trends'), {
      params: Promise.resolve({})
    })
    expect(aliasResponse.status).toBe(200)
    const tagsResponse = await GET(request(), { params: Promise.resolve({}) })
    expect(await aliasResponse.json()).toEqual(await tagsResponse.json())
  })
})
