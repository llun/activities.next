import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
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

describe('GET /api/v1/bookmarks', () => {
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
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('returns bookmarked statuses for the current actor with pagination links', async () => {
    const firstStatusId = `${ACTOR2_ID}/statuses/api-bookmarks-first`
    const secondStatusId = `${ACTOR2_ID}/statuses/api-bookmarks-second`
    await database.createNote({
      id: firstStatusId,
      url: firstStatusId,
      actorId: ACTOR2_ID,
      text: 'First bookmark',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createNote({
      id: secondStatusId,
      url: secondStatusId,
      actorId: ACTOR2_ID,
      text: 'Second bookmark',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createBookmark({
      actorId: ACTOR1_ID,
      statusId: firstStatusId
    })
    await database.createBookmark({
      actorId: ACTOR1_ID,
      statusId: secondStatusId
    })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/bookmarks?limit=1'),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Link')).toContain('/api/v1/bookmarks?')
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      id: expect.stringMatching(
        new RegExp(`^(${urlToId(firstStatusId)}|${urlToId(secondStatusId)})$`)
      ),
      bookmarked: true
    })
  })

  it('does not return another actor bookmarks', async () => {
    const statusId = `${ACTOR2_ID}/statuses/api-bookmarks-other-actor`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR2_ID,
      text: 'Other actor bookmark',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.createBookmark({
      actorId: ACTOR2_ID,
      statusId
    })

    const response = await GET(
      new NextRequest('https://llun.test/api/v1/bookmarks?limit=40'),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).not.toContainEqual(
      expect.objectContaining({ id: urlToId(statusId) })
    )
  })
})
