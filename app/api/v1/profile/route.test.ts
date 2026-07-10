import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { GET, PATCH } from './route'

vi.mock('@/lib/services/medias', () => ({ saveMedia: vi.fn() }))

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

vi.mock('better-auth/oauth2', () => ({ verifyAccessToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
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
    vi.clearAllMocks()
  })

  const createRequest = () =>
    new NextRequest('https://llun.test/api/v1/profile', { method: 'GET' })

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const response = await GET(createRequest(), { params: Promise.resolve({}) })
    expect(response.status).toBe(401)
  })

  it('returns the Profile entity with null avatar and raw note', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    await database.updateActor({
      actorId: ACTOR1_ID,
      summary: 'raw profile bio'
    })

    const response = await GET(createRequest(), { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const allowedMethods = response.headers.get('Access-Control-Allow-Methods')
    expect(allowedMethods).toContain('GET')
    expect(allowedMethods).toContain('PATCH')
    expect(allowedMethods).toContain('OPTIONS')

    const data = await response.json()
    expect(data).toEqual({
      id: expect.any(String),
      display_name: expect.any(String),
      note: 'raw profile bio',
      fields: [],
      avatar: null,
      avatar_static: null,
      avatar_description: '',
      header: null,
      header_static: null,
      header_description: '',
      locked: true,
      bot: false,
      hide_collections: null,
      discoverable: true,
      indexable: false,
      show_media: true,
      show_media_replies: true,
      show_featured: true,
      attribution_domains: []
    })
    // CredentialAccount-only keys must be gone from this endpoint.
    expect(data.source).toBeUndefined()
    expect(data.role).toBeUndefined()
    expect(data.acct).toBeUndefined()
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
    vi.clearAllMocks()
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
