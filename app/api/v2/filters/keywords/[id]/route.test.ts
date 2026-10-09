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

describe('/api/v2/filters/keywords/:id', () => {
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
  // send either; a PATCH must update the keyword instead of answering 405.
  it('updates the keyword when the request is sent as PATCH', async () => {
    const filter = await database.createFilter({
      actorId: ACTOR1_ID,
      title: 'patch-keyword-filter',
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: [{ keyword: 'patch-old', wholeWord: false }]
    })
    const [keyword] =
      (await database.getFilterKeywords({
        actorId: ACTOR1_ID,
        filterId: filter.id
      })) ?? []

    const response = await PATCH(
      new NextRequest(
        `https://llun.test/api/v2/filters/keywords/${keyword.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test',
            Referer: 'https://llun.test/'
          },
          body: JSON.stringify({ keyword: 'patch-new', whole_word: true })
        }
      ),
      { params: Promise.resolve({ id: keyword.id }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: keyword.id,
      keyword: 'patch-new',
      whole_word: true
    })
    expect(
      await database.getFilterKeyword({ actorId: ACTOR1_ID, id: keyword.id })
    ).toMatchObject({ keyword: 'patch-new', wholeWord: true })
  })

  it('advertises PATCH in the OPTIONS Access-Control-Allow-Methods header', async () => {
    const response = await OPTIONS(
      new NextRequest('https://llun.test/api/v2/filters/keywords/keyword-1', {
        method: 'OPTIONS',
        headers: { origin: 'https://llun.test' }
      })
    )

    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'PATCH'
    )
  })

  const keywordRequest = (
    id: string,
    method: 'GET' | 'PUT' | 'DELETE',
    body?: string,
    contentType = 'application/json'
  ) =>
    new NextRequest(`https://llun.test/api/v2/filters/keywords/${id}`, {
      method,
      headers: {
        'Content-Type': contentType,
        Origin: 'https://llun.test',
        Referer: 'https://llun.test/'
      },
      body
    })
  const context = (id: string) => ({ params: Promise.resolve({ id }) })

  // Creates a filter holding the given keywords for an actor and returns the
  // stored keyword rows in creation order.
  const createKeywords = async (
    actorId: string,
    title: string,
    words: string[]
  ) => {
    const filter = await database.createFilter({
      actorId,
      title,
      context: ['home'],
      filterAction: 'warn',
      expiresAt: null,
      keywords: words.map((keyword) => ({ keyword, wholeWord: false }))
    })
    const keywords =
      (await database.getFilterKeywords({ actorId, filterId: filter.id })) ?? []
    return { filter, keywords }
  }

  it.each([
    { method: 'GET' as const, handler: GET, body: undefined },
    {
      method: 'PUT' as const,
      handler: PUT,
      body: JSON.stringify({ keyword: 'x' })
    },
    { method: 'DELETE' as const, handler: DELETE, body: undefined }
  ])('$method answers 404 for an unknown keyword id', async (testCase) => {
    const { method, handler, body } = testCase

    const response = await handler(
      keywordRequest('missing', method, body),
      context('missing')
    )

    expect(response.status).toBe(404)
  })

  describe('GET', () => {
    it('returns the keyword in the Mastodon shape', async () => {
      const {
        keywords: [keyword]
      } = await createKeywords(ACTOR1_ID, 'kw-get', ['kw-get-word'])

      const response = await GET(
        keywordRequest(keyword.id, 'GET'),
        context(keyword.id)
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        id: keyword.id,
        keyword: 'kw-get-word',
        whole_word: false
      })
    })

    it("answers 404 for a keyword inside another account's filter", async () => {
      const {
        keywords: [foreign]
      } = await createKeywords(ACTOR2_ID, 'kw-get-foreign', ['foreign-word'])

      const response = await GET(
        keywordRequest(foreign.id, 'GET'),
        context(foreign.id)
      )

      expect(response.status).toBe(404)
    })
  })

  describe('PUT', () => {
    it('accepts a form-encoded body', async () => {
      const {
        keywords: [keyword]
      } = await createKeywords(ACTOR1_ID, 'kw-put-form', ['kw-put-form-word'])

      const response = await PUT(
        keywordRequest(
          keyword.id,
          'PUT',
          new URLSearchParams([
            ['keyword', 'form-renamed'],
            ['whole_word', 'true']
          ]).toString(),
          'application/x-www-form-urlencoded'
        ),
        context(keyword.id)
      )

      expect(response.status).toBe(200)
      expect(
        await database.getFilterKeyword({ actorId: ACTOR1_ID, id: keyword.id })
      ).toMatchObject({ keyword: 'form-renamed', wholeWord: true })
    })

    it('keeps the stored text when only whole_word is sent', async () => {
      const {
        keywords: [keyword]
      } = await createKeywords(ACTOR1_ID, 'kw-put-partial', ['partial-word'])

      const response = await PUT(
        keywordRequest(keyword.id, 'PUT', JSON.stringify({ whole_word: true })),
        context(keyword.id)
      )

      expect(response.status).toBe(200)
      expect(
        await database.getFilterKeyword({ actorId: ACTOR1_ID, id: keyword.id })
      ).toMatchObject({ keyword: 'partial-word', wholeWord: true })
    })

    it('answers 422 when renaming to a keyword the filter already has', async () => {
      const {
        keywords: [first, second]
      } = await createKeywords(ACTOR1_ID, 'kw-put-dup', ['dup-one', 'dup-two'])

      const response = await PUT(
        keywordRequest(
          second.id,
          'PUT',
          JSON.stringify({ keyword: 'dup-one' })
        ),
        context(second.id)
      )

      expect(response.status).toBe(422)
      expect(
        await database.getFilterKeyword({ actorId: ACTOR1_ID, id: second.id })
      ).toMatchObject({ keyword: 'dup-two' })
      expect(
        await database.getFilterKeyword({ actorId: ACTOR1_ID, id: first.id })
      ).toMatchObject({ keyword: 'dup-one' })
    })

    it('answers 422 for malformed JSON', async () => {
      const {
        keywords: [keyword]
      } = await createKeywords(ACTOR1_ID, 'kw-put-bad', ['bad-json-word'])

      const response = await PUT(
        keywordRequest(keyword.id, 'PUT', '{'),
        context(keyword.id)
      )

      expect(response.status).toBe(422)
    })

    it('answers 422 for a keyword over 100 characters', async () => {
      const {
        keywords: [keyword]
      } = await createKeywords(ACTOR1_ID, 'kw-put-long', ['long-word'])

      const response = await PUT(
        keywordRequest(
          keyword.id,
          'PUT',
          JSON.stringify({ keyword: 'x'.repeat(101) })
        ),
        context(keyword.id)
      )

      expect(response.status).toBe(422)
      expect(
        await database.getFilterKeyword({ actorId: ACTOR1_ID, id: keyword.id })
      ).toMatchObject({ keyword: 'long-word' })
    })

    it("cannot edit a keyword inside another account's filter", async () => {
      const {
        keywords: [foreign]
      } = await createKeywords(ACTOR2_ID, 'kw-put-foreign', ['foreign-put'])

      const response = await PUT(
        keywordRequest(
          foreign.id,
          'PUT',
          JSON.stringify({ keyword: 'stolen' })
        ),
        context(foreign.id)
      )

      expect(response.status).toBe(404)
      expect(
        await database.getFilterKeyword({ actorId: ACTOR2_ID, id: foreign.id })
      ).toMatchObject({ keyword: 'foreign-put' })
    })
  })

  describe('DELETE', () => {
    it('removes only the targeted keyword', async () => {
      const {
        filter,
        keywords: [target, sibling]
      } = await createKeywords(ACTOR1_ID, 'kw-delete', ['gone', 'stays'])

      const response = await DELETE(
        keywordRequest(target.id, 'DELETE'),
        context(target.id)
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
      expect(
        (
          await database.getFilterKeywords({
            actorId: ACTOR1_ID,
            filterId: filter.id
          })
        )?.map((k) => k.id)
      ).toEqual([sibling.id])
    })

    it("cannot delete a keyword inside another account's filter", async () => {
      const {
        keywords: [foreign]
      } = await createKeywords(ACTOR2_ID, 'kw-delete-foreign', ['foreign-del'])

      const response = await DELETE(
        keywordRequest(foreign.id, 'DELETE'),
        context(foreign.id)
      )

      expect(response.status).toBe(404)
      expect(
        await database.getFilterKeyword({ actorId: ACTOR2_ID, id: foreign.id })
      ).not.toBeNull()
    })
  })
})
