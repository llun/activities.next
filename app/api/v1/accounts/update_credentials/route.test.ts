import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { saveMedia } from '@/lib/services/medias'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'

import { PATCH } from './route'

vi.mock('@/lib/services/medias', () => ({ saveMedia: vi.fn() }))

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    trustedHosts: ['alias.llun.test'],
    secretPhase: 'test-secret'
  })
}))

describe('PATCH /api/v1/accounts/update_credentials', () => {
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

  const createRequest = (form: FormData) => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: { origin: 'https://llun.test' }
      }
    )
    // jest / undici cannot materialise a multipart body from a FormData object
    // passed to NextRequest — mock formData() directly, matching the pattern
    // used in app/api/v1/statuses/route.test.ts.
    Object.defineProperty(req, 'formData', {
      value: vi.fn().mockResolvedValue(form)
    })
    return req
  }

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const form = new FormData()
    form.set('display_name', 'Nope')
    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(401)
  })

  it('updates display name and note and returns the credential account', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const form = new FormData()
    form.set('display_name', 'New Name')
    form.set('note', 'New bio')
    form.set('locked', 'true')

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR1_ID,
        name: 'New Name',
        summary: 'New bio',
        manuallyApprovesFollowers: true
      })
    )
    const data = await response.json()
    expect(data).toEqual(expect.objectContaining({ id: expect.any(String) }))
    updateActor.mockRestore()
  })

  it('accepts a request with no recognized fields without error', async () => {
    const response = await PATCH(createRequest(new FormData()), {
      params: Promise.resolve({})
    })
    expect(response.status).toBe(200)
  })

  it('keeps the existing image when media storage returns nothing', async () => {
    const saveMediaMock = saveMedia as jest.Mock
    // Unconfigured storage: saveMedia yields nothing, so no icon/header URL.
    saveMediaMock.mockResolvedValue(null)
    const updateActor = vi.spyOn(database, 'updateActor')
    const form = new FormData()
    form.set('display_name', 'With Avatar')
    form.set(
      'avatar',
      new Blob(['fake-image'], { type: 'image/png' }),
      'avatar.png'
    )

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'With Avatar' })
    )
    expect(updateActor).toHaveBeenCalledWith(
      expect.not.objectContaining({
        iconUrl: expect.anything(),
        headerImageUrl: expect.anything()
      })
    )
    updateActor.mockRestore()
  })

  it('unlocks the account when locked=false', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const form = new FormData()
    form.set('locked', 'false')

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR1_ID,
        manuallyApprovesFollowers: false
      })
    )
    updateActor.mockRestore()
  })

  it('accepts a JSON body with boolean locked', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({ display_name: 'JSON Name', locked: true })
      }
    )

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'JSON Name',
        manuallyApprovesFollowers: true
      })
    )
    updateActor.mockRestore()
  })

  it('rejects malformed JSON body with 400', async () => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: 'not json'
      }
    )

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
  })

  it('ignores unknown/unexpected fields (no mass assignment)', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({
          display_name: 'Safe',
          id: 'attacker',
          role: 'admin',
          privateKey: 'x',
          publicKey: 'y'
        })
      }
    )

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Safe' })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.anything() })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ role: expect.anything() })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ privateKey: expect.anything() })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ publicKey: expect.anything() })
    )
    updateActor.mockRestore()
  })

  it('treats locked=on as locked (HTML checkbox form)', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const form = new FormData()
    form.set('locked', 'on')

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR1_ID,
        manuallyApprovesFollowers: true
      })
    )
    updateActor.mockRestore()
  })

  it('treats locked=off as unlocked (HTML checkbox form)', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const form = new FormData()
    form.set('locked', 'off')

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR1_ID,
        manuallyApprovesFollowers: false
      })
    )
    updateActor.mockRestore()
  })

  it('uploads avatar/header via the media-save path and stores the URLs', async () => {
    const saveMediaMock = saveMedia as jest.Mock
    saveMediaMock
      .mockResolvedValueOnce({ url: 'https://llun.test/media/avatar.png' })
      .mockResolvedValueOnce({ url: 'https://llun.test/media/header.png' })
    const updateActor = vi.spyOn(database, 'updateActor')

    const form = new FormData()
    form.set(
      'avatar',
      new Blob(['avatar-bytes'], { type: 'image/png' }),
      'avatar.png'
    )
    form.set(
      'header',
      new Blob(['header-bytes'], { type: 'image/png' }),
      'header.png'
    )

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(saveMediaMock).toHaveBeenCalledTimes(2)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        iconUrl: 'https://llun.test/media/avatar.png',
        headerImageUrl: 'https://llun.test/media/header.png'
      })
    )
    updateActor.mockRestore()
  })

  it('rejects an avatar file that fails media validation with 422', async () => {
    const saveMediaMock = saveMedia as jest.Mock
    const updateActor = vi.spyOn(database, 'updateActor')
    const form = new FormData()
    // text/plain is not an accepted media type, so MediaSchema rejects it.
    form.set(
      'avatar',
      new Blob(['not-an-image'], { type: 'text/plain' }),
      'a.txt'
    )

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(422)
    expect(saveMediaMock).not.toHaveBeenCalled()
    expect(updateActor).not.toHaveBeenCalled()
    updateActor.mockRestore()
  })

  it('rejects more than four profile fields with 422', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const form = new FormData()
    for (let i = 0; i < 5; i += 1) {
      form.set(`fields_attributes[${i}][name]`, `n${i}`)
      form.set(`fields_attributes[${i}][value]`, `v${i}`)
    }

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(422)
    expect(updateActor).not.toHaveBeenCalled()
    updateActor.mockRestore()
  })

  it('persists fields_attributes, bot, discoverable and source defaults (multipart)', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const form = new FormData()
    form.set('fields_attributes[0][name]', 'Website')
    form.set('fields_attributes[0][value]', 'https://example.com')
    form.set('fields_attributes[1][name]', 'Pronouns')
    form.set('fields_attributes[1][value]', 'they/them')
    form.set('bot', 'true')
    form.set('discoverable', 'false')
    form.set('source[privacy]', 'private')
    form.set('source[sensitive]', 'true')
    form.set('source[language]', 'th')

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR1_ID,
        fields: [
          { name: 'Website', value: 'https://example.com' },
          { name: 'Pronouns', value: 'they/them' }
        ],
        bot: true,
        discoverable: false,
        defaultPrivacy: 'private',
        defaultSensitive: true,
        defaultLanguage: 'th'
      })
    )

    const data = await response.json()
    // CredentialAccount carries a role and the reflected fields/source.
    expect(data.role).toEqual(
      expect.objectContaining({ id: expect.any(String) })
    )
    expect(data.fields).toEqual([
      { name: 'Website', value: 'https://example.com', verified_at: null },
      { name: 'Pronouns', value: 'they/them', verified_at: null }
    ])
    expect(data.source.privacy).toBe('private')
    updateActor.mockRestore()
  })

  it('persists indexable and hide_collections flags (multipart)', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const form = new FormData()
    form.set('indexable', 'true')
    form.set('hide_collections', 'true')

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ACTOR1_ID,
        indexable: true,
        hideCollections: true
      })
    )
    const data = await response.json()
    expect(data.indexable).toBe(true)
    expect(data.hide_collections).toBe(true)
    updateActor.mockRestore()
  })

  it.each([
    {
      description:
        'collects repeated attribution_domains[] multipart entries into an array',
      key: 'attribution_domains[]'
    },
    {
      description:
        'collects repeated bare attribution_domains multipart entries into an array',
      key: 'attribution_domains'
    }
  ])('$description', async ({ key }) => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const form = new FormData()
    form.append(key, 'Blog.example.com ')
    form.append(key, 'news.example.com')

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        attributionDomains: ['blog.example.com', 'news.example.com']
      })
    )
    updateActor.mockRestore()
  })

  it('deduplicates attribution_domains and drops empty/whitespace entries', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const form = new FormData()
    form.append('attribution_domains[]', 'blog.example.com')
    form.append('attribution_domains[]', 'BLOG.example.com')
    form.append('attribution_domains[]', '   ')
    form.append('attribution_domains[]', 'blog.example.com')

    const response = await PATCH(createRequest(form), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        attributionDomains: ['blog.example.com']
      })
    )
    updateActor.mockRestore()
  })

  it('accepts modern fields via a JSON body and clears attribution domains with []', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({
          indexable: false,
          hide_collections: false,
          attribution_domains: []
        })
      }
    )

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        indexable: false,
        hideCollections: false,
        attributionDomains: []
      })
    )
    // The spied updateActor calls through to the real test DB, so the response
    // reflects the persisted values: a stored `false` must serialize as `false`,
    // not `null` — the one branch a `?? null` -> `|| null` regression would break.
    const data = await response.json()
    expect(data.indexable).toBe(false)
    expect(data.hide_collections).toBe(false)
    updateActor.mockRestore()
  })

  it('accepts fields_attributes via a JSON body', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: JSON.stringify({
          fields_attributes: [{ name: 'Site', value: 'https://a.test' }]
        })
      }
    )

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(updateActor).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: [{ name: 'Site', value: 'https://a.test' }]
      })
    )
    updateActor.mockRestore()
  })

  it('accepts an empty JSON body as a no-op (200)', async () => {
    const updateActor = vi.spyOn(database, 'updateActor')
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: ''
      }
    )

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: expect.anything()
      })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.anything()
      })
    )
    expect(updateActor).not.toHaveBeenCalledWith(
      expect.objectContaining({
        manuallyApprovesFollowers: expect.anything()
      })
    )
    updateActor.mockRestore()
  })

  it('localizes the returned acct to the access domain', async () => {
    const req = new NextRequest(
      'https://llun.test/api/v1/accounts/update_credentials',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test',
          'x-forwarded-host': 'alias.llun.test'
        },
        body: JSON.stringify({})
      }
    )

    const response = await PATCH(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const data = await response.json()
    // Actor1 lives on llun.test; seen through the alias access domain the acct
    // must be qualified, matching verify_credentials behavior.
    expect(data.acct).toBe('test1@llun.test')
  })
})
