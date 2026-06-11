import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET, PATCH } from './route'

jest.mock('@/lib/services/medias', () => ({ saveMedia: jest.fn() }))

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

describe('GET /api/v1/profile', () => {
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
  })

  const createRequest = () =>
    new NextRequest('https://llun.test/api/v1/profile', { method: 'GET' })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
  })

  it('returns the current actor CredentialAccount', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })

    const response = await GET(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        username: seedActor1.username,
        acct: seedActor1.username,
        source: expect.objectContaining({
          note: expect.any(String),
          privacy: expect.any(String),
          follow_requests_count: expect.any(Number)
        }),
        role: expect.objectContaining({
          id: expect.any(String),
          permissions: expect.any(String)
        })
      })
    )
  })
})

describe('PATCH /api/v1/profile', () => {
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

  const createJsonRequest = (body: unknown) =>
    new NextRequest('https://llun.test/api/v1/profile', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: JSON.stringify(body)
    })

  it('updates a field and persists the change', async () => {
    const response = await PATCH(
      createJsonRequest({ display_name: 'Profile Name', note: 'Profile bio' }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        display_name: 'Profile Name',
        source: expect.objectContaining({ note: 'Profile bio' })
      })
    )

    const actor = await database.getActorFromId({ id: ACTOR1_ID })
    expect(actor?.name).toBe('Profile Name')
    expect(actor?.summary).toBe('Profile bio')
  })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await PATCH(createJsonRequest({ display_name: 'Nope' }), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(401)
  })

  it('returns 422 when a field fails validation', async () => {
    const response = await PATCH(
      createJsonRequest({ display_name: 'a'.repeat(256) }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(422)
  })

  it('advertises GET, PATCH and OPTIONS in the Access-Control-Allow-Methods header', async () => {
    const response = await PATCH(
      createJsonRequest({ display_name: 'Profile Name' }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    const allowedMethods = response.headers.get('Access-Control-Allow-Methods')
    expect(allowedMethods).toContain('GET')
    expect(allowedMethods).toContain('PATCH')
    expect(allowedMethods).toContain('OPTIONS')
  })
})
