import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'
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
  new NextRequest(
    `https://llun.test/api/v1/accounts/familiar_followers?${query}`,
    { method: 'GET' }
  )

describe('GET /api/v1/accounts/familiar_followers', () => {
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
      user: { email: seedActor3.email }
    })
  })

  it('returns FamiliarFollowers entries with {id, accounts}', async () => {
    const response = await GET(createRequest(`id[]=${urlToId(ACTOR4_ID)}`), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(urlToId(ACTOR4_ID))
    expect(Array.isArray(data[0].accounts)).toBe(true)
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
    const response = await GET(createRequest(`id=${urlToId(ACTOR4_ID)}`), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(401)
  })
})
