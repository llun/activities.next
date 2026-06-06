import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET as getStatusSource } from './route'

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

describe('GET /api/v1/statuses/[id]/source', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('returns the StatusSource shape { id, text, spoiler_text }', async () => {
    const statusId = `${ACTOR1_ID}/statuses/api-source-shape`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'The plain-text source of the status',
      summary: 'A content warning',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const response = await getStatusSource(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(statusId)}/source`
      ),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      id: urlToId(statusId),
      text: 'The plain-text source of the status',
      spoiler_text: 'A content warning'
    })
  })

  it('returns an empty spoiler_text when the status has no content warning', async () => {
    const statusId = `${ACTOR1_ID}/statuses/api-source-no-cw`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'No content warning here',
      summary: null,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })

    const response = await getStatusSource(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(statusId)}/source`
      ),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual({
      id: urlToId(statusId),
      text: 'No content warning here',
      spoiler_text: ''
    })
  })

  it('returns 404 for a non-existent status', async () => {
    const statusId = `${ACTOR1_ID}/statuses/api-source-missing`
    const response = await getStatusSource(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(statusId)}/source`
      ),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

    expect(response.status).toBe(404)
  })
})
