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
    // The PATCH now returns a Profile: `note` is top-level raw text and there
    // is no CredentialAccount `source`/`role`.
    expect(data).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        display_name: 'Profile Name',
        note: 'Profile bio'
      })
    )
    expect(data.source).toBeUndefined()
    expect(data.role).toBeUndefined()

    const actor = await database.getActorFromId({ id: ACTOR1_ID })
    expect(actor?.name).toBe('Profile Name')
    expect(actor?.summary).toBe('Profile bio')
  })

  it.each([
    {
      description: 'persists avatar_description',
      body: { avatar_description: 'Coffee cup close-up' },
      responseKey: 'avatar_description',
      expected: 'Coffee cup close-up',
      settingsKey: 'avatarDescription'
    },
    {
      description: 'persists header_description',
      body: { header_description: 'Mountains at dawn' },
      responseKey: 'header_description',
      expected: 'Mountains at dawn',
      settingsKey: 'headerDescription'
    },
    {
      description: 'persists show_media false',
      body: { show_media: false },
      responseKey: 'show_media',
      expected: false,
      settingsKey: 'showMedia'
    },
    {
      description: 'persists show_media_replies false',
      body: { show_media_replies: false },
      responseKey: 'show_media_replies',
      expected: false,
      settingsKey: 'showMediaReplies'
    },
    {
      description: 'persists show_featured false',
      body: { show_featured: false },
      responseKey: 'show_featured',
      expected: false,
      settingsKey: 'showFeatured'
    },
    {
      description: 'persists attribution_domains',
      body: { attribution_domains: ['news.example.com'] },
      responseKey: 'attribution_domains',
      expected: ['news.example.com'],
      settingsKey: 'attributionDomains'
    }
  ])('$description', async ({ body, responseKey, expected, settingsKey }) => {
    const response = await PATCH(createJsonRequest(body), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data[responseKey]).toEqual(expected)

    const settings = await database.getActorSettings({ actorId: ACTOR1_ID })
    expect(settings?.[settingsKey as keyof typeof settings]).toEqual(expected)
  })

  it('collects attribution_domains[] entries from form bodies', async () => {
    const form = new FormData()
    form.append('attribution_domains[]', 'news.example.com')
    form.append('attribution_domains[]', 'blog.example.com')

    // undici in this test env cannot materialise a multipart body from a
    // FormData passed to NextRequest, so mock formData() directly — the same
    // pattern the update_credentials route tests use.
    const req = new NextRequest('https://llun.test/api/v1/profile', {
      method: 'PATCH',
      headers: { origin: 'https://llun.test' }
    })
    Object.defineProperty(req, 'formData', {
      value: vi.fn().mockResolvedValue(form)
    })

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.attribution_domains).toEqual([
      'news.example.com',
      'blog.example.com'
    ])
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
