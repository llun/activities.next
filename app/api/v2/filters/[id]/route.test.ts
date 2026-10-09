import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { DELETE, GET, OPTIONS, PATCH, PUT } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => null
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('PATCH /api/v2/filters/:id', () => {
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

  // Rails `resources` maps update to both PATCH and PUT, so Mastodon clients may
  // send either; a PATCH must update the filter instead of answering 405.
  it('updates the filter when the request is sent as PATCH', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'patch-old',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'patch-old', wholeWord: false }]
    })

    const response = await PATCH(
      new NextRequest(`https://llun.test/api/v2/filters/${filter.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test',
          Referer: 'https://llun.test/'
        },
        body: JSON.stringify({
          title: 'patch-new',
          context: ['home', 'public'],
          filter_action: 'hide'
        })
      }),
      { params: Promise.resolve({ id: filter.id }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: filter.id,
      title: 'patch-new',
      context: ['home', 'public'],
      filter_action: 'hide'
    })
    expect(
      await database.getFilter({ actorId: ACTOR1_ID, id: filter.id })
    ).toMatchObject({
      title: 'patch-new',
      context: ['home', 'public'],
      filterAction: 'hide'
    })
  })

  it('advertises PATCH in the OPTIONS Access-Control-Allow-Methods header', async () => {
    const response = await OPTIONS(
      new NextRequest('https://llun.test/api/v2/filters/filter-1', {
        method: 'OPTIONS',
        headers: { origin: 'https://llun.test' }
      })
    )

    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'PATCH'
    )
  })

  const idRequest = (
    id: string,
    method: 'GET' | 'PUT' | 'DELETE',
    body?: string,
    contentType = 'application/json'
  ) =>
    new NextRequest(`https://llun.test/api/v2/filters/${id}`, {
      method,
      headers: {
        'Content-Type': contentType,
        Origin: 'https://llun.test',
        Referer: 'https://llun.test/'
      },
      body
    })
  const context = (id: string) => ({ params: Promise.resolve({ id }) })

  const createFilterFor = (actorId: string, title: string) =>
    database.createFilter({
      actorId,
      title,
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: `${title}-word`, wholeWord: true }]
    })

  describe('GET', () => {
    it('returns the filter with its keywords in the Mastodon shape', async () => {
      const filter = await createFilterFor(ACTOR1_ID, 'get-own')

      const response = await GET(
        idRequest(filter.id, 'GET'),
        context(filter.id)
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        id: filter.id,
        title: 'get-own',
        context: ['home'],
        filter_action: 'warn',
        keywords: [{ keyword: 'get-own-word', whole_word: true }]
      })
    })

    it('answers 404 for an unknown filter id', async () => {
      const response = await GET(
        idRequest('missing', 'GET'),
        context('missing')
      )

      expect(response.status).toBe(404)
    })

    it("answers 404 for another account's filter instead of exposing it", async () => {
      const foreign = await createFilterFor(ACTOR2_ID, 'get-foreign')

      const response = await GET(
        idRequest(foreign.id, 'GET'),
        context(foreign.id)
      )

      expect(response.status).toBe(404)
    })

    it('answers 401 when the caller is not signed in', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const filter = await createFilterFor(ACTOR1_ID, 'get-anon')

      const response = await GET(
        idRequest(filter.id, 'GET'),
        context(filter.id)
      )

      expect(response.status).toBe(401)
    })
  })

  describe('PUT', () => {
    it('adds, renames and removes keywords through keywords_attributes', async () => {
      const filter = await database.createFilter({
        actorId: ACTOR1_ID,
        title: 'put-keywords',
        context: ['home'],
        filterAction: 'warn',
        expiresAt: null,
        keywords: [
          { keyword: 'keep-me', wholeWord: false },
          { keyword: 'drop-me', wholeWord: false }
        ]
      })
      const existing =
        (await database.getFilterKeywords({
          actorId: ACTOR1_ID,
          filterId: filter.id
        })) ?? []
      const keep = existing.find((k) => k.keyword === 'keep-me')!
      const drop = existing.find((k) => k.keyword === 'drop-me')!

      const response = await PUT(
        idRequest(
          filter.id,
          'PUT',
          JSON.stringify({
            keywords_attributes: [
              { id: keep.id, keyword: 'renamed', whole_word: true },
              { id: drop.id, _destroy: true },
              { keyword: 'brand-new' }
            ]
          })
        ),
        context(filter.id)
      )

      expect(response.status).toBe(200)
      const stored = await database.getFilterKeywords({
        actorId: ACTOR1_ID,
        filterId: filter.id
      })
      expect(
        stored
          ?.map((k) => ({ keyword: k.keyword, wholeWord: k.wholeWord }))
          .sort((a, b) => a.keyword.localeCompare(b.keyword))
      ).toEqual([
        { keyword: 'brand-new', wholeWord: false },
        { keyword: 'renamed', wholeWord: true }
      ])
    })

    it('accepts a form-encoded body and sets an expiry from expires_in', async () => {
      const filter = await createFilterFor(ACTOR1_ID, 'put-form')
      const before = Date.now()

      const response = await PUT(
        idRequest(
          filter.id,
          'PUT',
          new URLSearchParams([
            ['title', 'put-form-renamed'],
            ['context[]', 'notifications'],
            ['expires_in', '3600']
          ]).toString(),
          'application/x-www-form-urlencoded'
        ),
        context(filter.id)
      )

      expect(response.status).toBe(200)
      const stored = await database.getFilter({
        actorId: ACTOR1_ID,
        id: filter.id
      })
      expect(stored).toMatchObject({
        title: 'put-form-renamed',
        context: ['notifications']
      })
      expect(stored?.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000)
    })

    it.each([
      { description: 'a blank title', body: JSON.stringify({ title: '  ' }) },
      {
        description: 'an empty context',
        body: JSON.stringify({ context: [] })
      },
      {
        description: 'an unparseable expiry',
        body: JSON.stringify({ expires_in: 'soon' })
      },
      { description: 'malformed JSON', body: '{' }
    ])(
      'answers 422 and leaves the filter untouched for $description',
      async ({ body }) => {
        const filter = await createFilterFor(ACTOR1_ID, 'put-invalid')

        const response = await PUT(
          idRequest(filter.id, 'PUT', body),
          context(filter.id)
        )

        expect(response.status).toBe(422)
        expect(
          await database.getFilter({ actorId: ACTOR1_ID, id: filter.id })
        ).toMatchObject({ title: 'put-invalid', context: ['home'] })
      }
    )

    it('answers 404 for an unknown filter id', async () => {
      const response = await PUT(
        idRequest('missing', 'PUT', JSON.stringify({ title: 'x' })),
        context('missing')
      )

      expect(response.status).toBe(404)
    })

    it("cannot modify another account's filter", async () => {
      const foreign = await createFilterFor(ACTOR2_ID, 'put-foreign')

      const response = await PUT(
        idRequest(foreign.id, 'PUT', JSON.stringify({ title: 'hijacked' })),
        context(foreign.id)
      )

      expect(response.status).toBe(404)
      expect(
        await database.getFilter({ actorId: ACTOR2_ID, id: foreign.id })
      ).toMatchObject({ title: 'put-foreign' })
    })
  })

  describe('DELETE', () => {
    it('deletes the filter and its keywords', async () => {
      const filter = await createFilterFor(ACTOR1_ID, 'delete-own')

      const response = await DELETE(
        idRequest(filter.id, 'DELETE'),
        context(filter.id)
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
      expect(
        await database.getFilter({ actorId: ACTOR1_ID, id: filter.id })
      ).toBeNull()
      expect(
        await database.getFilterKeywords({
          actorId: ACTOR1_ID,
          filterId: filter.id
        })
      ).toBeNull()
    })

    it('answers 404 when deleting the same filter twice', async () => {
      const filter = await createFilterFor(ACTOR1_ID, 'delete-twice')
      await DELETE(idRequest(filter.id, 'DELETE'), context(filter.id))

      const response = await DELETE(
        idRequest(filter.id, 'DELETE'),
        context(filter.id)
      )

      expect(response.status).toBe(404)
    })

    it("cannot delete another account's filter", async () => {
      const foreign = await createFilterFor(ACTOR2_ID, 'delete-foreign')

      const response = await DELETE(
        idRequest(foreign.id, 'DELETE'),
        context(foreign.id)
      )

      expect(response.status).toBe(404)
      expect(
        await database.getFilter({ actorId: ACTOR2_ID, id: foreign.id })
      ).not.toBeNull()
    })
  })
})
