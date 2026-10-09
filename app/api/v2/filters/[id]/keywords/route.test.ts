import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { GET, POST } from './route'

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

describe('/api/v2/filters/:id/keywords', () => {
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

  const createFilterFor = (actorId: string, title: string, words: string[]) =>
    database.createFilter({
      actorId,
      title,
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: words.map((keyword) => ({ keyword, wholeWord: false }))
    })

  const keywordsUrl = (filterId: string) =>
    `https://llun.test/api/v2/filters/${filterId}/keywords`
  const context = (id: string) => ({ params: Promise.resolve({ id }) })

  const getRequest = (filterId: string) =>
    new NextRequest(keywordsUrl(filterId), {
      headers: { Origin: 'https://llun.test' }
    })
  const postRequest = (
    filterId: string,
    body: string,
    contentType = 'application/json'
  ) =>
    new NextRequest(keywordsUrl(filterId), {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Origin: 'https://llun.test',
        Referer: 'https://llun.test/'
      },
      body
    })

  describe('GET', () => {
    it('lists the filter keywords in creation order', async () => {
      const filter = await createFilterFor(ACTOR1_ID, 'list-kw', [
        'first',
        'second'
      ])

      const response = await GET(getRequest(filter.id), context(filter.id))

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.map((k: { keyword: string }) => k.keyword)).toEqual([
        'first',
        'second'
      ])
      expect(body[0]).toEqual({
        id: expect.any(String),
        keyword: 'first',
        whole_word: false
      })
    })

    it('returns an empty list for a filter without keywords', async () => {
      const filter = await createFilterFor(ACTOR1_ID, 'list-empty', [])

      const response = await GET(getRequest(filter.id), context(filter.id))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual([])
    })

    it('answers 404 for an unknown filter id', async () => {
      const response = await GET(getRequest('missing'), context('missing'))

      expect(response.status).toBe(404)
    })

    it("answers 404 for another account's filter instead of listing its keywords", async () => {
      const foreign = await createFilterFor(ACTOR2_ID, 'list-foreign', [
        'secret'
      ])

      const response = await GET(getRequest(foreign.id), context(foreign.id))

      expect(response.status).toBe(404)
    })

    it('answers 401 when the caller is not signed in', async () => {
      mockGetServerSession.mockResolvedValue(null)
      const filter = await createFilterFor(ACTOR1_ID, 'list-anon', ['x'])

      const response = await GET(getRequest(filter.id), context(filter.id))

      expect(response.status).toBe(401)
    })
  })

  describe('POST', () => {
    it('adds a keyword (trimmed, whole_word coerced) to the filter', async () => {
      const filter = await createFilterFor(ACTOR1_ID, 'add-kw', [])

      const response = await POST(
        postRequest(
          filter.id,
          JSON.stringify({ keyword: '  added ', whole_word: 'true' })
        ),
        context(filter.id)
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        id: expect.any(String),
        keyword: 'added',
        whole_word: true
      })
      expect(
        (
          await database.getFilterKeywords({
            actorId: ACTOR1_ID,
            filterId: filter.id
          })
        )?.map((k) => ({ keyword: k.keyword, wholeWord: k.wholeWord }))
      ).toEqual([{ keyword: 'added', wholeWord: true }])
    })

    it('accepts a form-encoded body', async () => {
      const filter = await createFilterFor(ACTOR1_ID, 'add-kw-form', [])

      const response = await POST(
        postRequest(
          filter.id,
          new URLSearchParams([['keyword', 'from-form']]).toString(),
          'application/x-www-form-urlencoded'
        ),
        context(filter.id)
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ keyword: 'from-form' })
    })

    it('is idempotent: re-adding an existing keyword returns the stored one without a duplicate', async () => {
      const filter = await createFilterFor(ACTOR1_ID, 'add-kw-twice', [])
      const first = await (
        await POST(
          postRequest(filter.id, JSON.stringify({ keyword: 'again' })),
          context(filter.id)
        )
      ).json()

      const response = await POST(
        postRequest(filter.id, JSON.stringify({ keyword: 'again' })),
        context(filter.id)
      )

      expect(response.status).toBe(200)
      expect((await response.json()).id).toBe(first.id)
      expect(
        await database.getFilterKeywords({
          actorId: ACTOR1_ID,
          filterId: filter.id
        })
      ).toHaveLength(1)
    })

    it.each([
      { description: 'a missing keyword', body: JSON.stringify({}) },
      {
        description: 'a blank keyword',
        body: JSON.stringify({ keyword: ' ' })
      },
      {
        description: 'a keyword over 100 characters',
        body: JSON.stringify({ keyword: 'x'.repeat(101) })
      },
      { description: 'malformed JSON', body: '{' }
    ])('answers 422 and stores nothing for $description', async ({ body }) => {
      const filter = await createFilterFor(ACTOR1_ID, 'add-kw-invalid', [])

      const response = await POST(
        postRequest(filter.id, body),
        context(filter.id)
      )

      expect(response.status).toBe(422)
      expect(
        await database.getFilterKeywords({
          actorId: ACTOR1_ID,
          filterId: filter.id
        })
      ).toEqual([])
    })

    it('answers 404 for an unknown filter id', async () => {
      const response = await POST(
        postRequest('missing', JSON.stringify({ keyword: 'x' })),
        context('missing')
      )

      expect(response.status).toBe(404)
    })

    it("cannot add a keyword to another account's filter", async () => {
      const foreign = await createFilterFor(ACTOR2_ID, 'add-kw-foreign', [])

      const response = await POST(
        postRequest(foreign.id, JSON.stringify({ keyword: 'injected' })),
        context(foreign.id)
      )

      expect(response.status).toBe(404)
      expect(
        await database.getFilterKeywords({
          actorId: ACTOR2_ID,
          filterId: foreign.id
        })
      ).toEqual([])
    })
  })
})
