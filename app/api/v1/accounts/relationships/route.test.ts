import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
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

const createRequest = (query: string) =>
  new NextRequest(`https://llun.test/api/v1/accounts/relationships?${query}`, {
    method: 'GET'
  })

describe('GET /api/v1/accounts/relationships', () => {
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

  it('accepts id[] and returns relationships in request order', async () => {
    const query = `id[]=${urlToId(ACTOR2_ID)}&id[]=${urlToId(ACTOR3_ID)}`
    const response = await GET(createRequest(query), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(2)
    expect(data[0].id).toBe(urlToId(ACTOR2_ID))
    expect(data[1].id).toBe(urlToId(ACTOR3_ID))
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
    expect(data[0].id).toBe(urlToId(ACTOR3_ID))
  })

  it('returns an empty array when no ids are provided', async () => {
    const response = await GET(createRequest(''), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(createRequest(`id=${urlToId(ACTOR2_ID)}`), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(401)
  })
})
