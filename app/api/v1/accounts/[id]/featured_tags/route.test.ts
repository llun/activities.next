import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { urlToId } from '@/lib/utils/urlToId'

import { GET } from './route'

const mockGetServerSession = jest.fn()
jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => undefined
}))

jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn().mockReturnValue(undefined)
  })
}))

jest.mock('better-auth/oauth2', () => ({ verifyAccessToken: jest.fn() }))

jest.mock('@/lib/config', () => ({
  getBaseURL: jest.fn().mockReturnValue('https://llun.test'),
  getConfig: jest.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const createRequest = (targetId: string) =>
  new NextRequest(
    `https://llun.test/api/v1/accounts/${urlToId(targetId)}/featured_tags`,
    { method: 'GET', headers: { host: 'llun.test' } }
  )

const invoke = (targetId: string) =>
  GET(createRequest(targetId), {
    params: Promise.resolve({ id: urlToId(targetId) })
  })

describe('GET /api/v1/accounts/:id/featured_tags', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    // Tag one of Actor1's public statuses and feature the hashtag.
    await database.createTag({
      statusId: `${ACTOR1_ID}/statuses/post-1`,
      type: 'hashtag',
      name: '#Running',
      value: 'https://llun.test/tags/running'
    })
    await database.createFeaturedTag({ actorId: ACTOR1_ID, name: '#Running' })
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    // Public endpoint — no session.
    mockGetServerSession.mockResolvedValue(null)
  })

  it('returns the local actor featured tags with derived stats (no auth)', async () => {
    const response = await invoke(ACTOR1_ID)
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      name: 'Running',
      url: 'https://llun.test/@test1/tagged/Running',
      statuses_count: '1'
    })
    expect(data[0].last_status_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns [] for a remote actor with no stored featured tags (not 500)', async () => {
    const response = await invoke(EXTERNAL_ACTOR1)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  it('returns 404 for an unknown account', async () => {
    const response = await invoke('https://llun.test/users/does-not-exist')
    expect(response.status).toBe(404)
  })
})
