import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { FilterAction, FilterContext } from '@/lib/types/domain/filter'

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
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('/api/v1/filters/[id]', () => {
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

  const requestFor = (id: string, init?: { method?: string; body?: object }) =>
    new NextRequest(`https://llun.test/api/v1/filters/${id}`, {
      method: init?.method ?? 'GET',
      headers: init?.body
        ? {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test',
            Referer: 'https://llun.test/'
          }
        : { Origin: 'https://llun.test' },
      body: init?.body ? JSON.stringify(init.body) : undefined
    })

  const createFilterFixture = async (options: {
    actorId?: string
    title: string
    context?: FilterContext[]
    filterAction?: FilterAction
    keywords: { keyword: string; wholeWord?: boolean }[]
  }) => {
    const actorId = options.actorId ?? ACTOR1_ID
    const filter = await database.createFilter({
      actorId,
      title: options.title,
      context: options.context ?? ['home'],
      filterAction: options.filterAction ?? 'warn',
      expiresAt: null,
      keywords: options.keywords
    })
    const keywords =
      (await database.getFilterKeywords({ actorId, filterId: filter.id })) ?? []
    return { filter, keywords }
  }

  const keywordId = (
    keywords: { id: string; keyword: string }[],
    text: string
  ) => keywords.find((entry) => entry.keyword === text)?.id ?? ''

  it('returns the v1 view addressed by the keyword id', async () => {
    const { keywords } = await createFilterFixture({
      title: 'get-phrase',
      filterAction: 'hide',
      keywords: [{ keyword: 'get-phrase', wholeWord: true }]
    })
    const id = keywordId(keywords, 'get-phrase')

    const response = await GET(requestFor(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id,
      phrase: 'get-phrase',
      context: ['home'],
      expires_at: null,
      irreversible: true,
      whole_word: true
    })
  })

  it('returns 404 for a keyword owned by another actor', async () => {
    const { keywords } = await createFilterFixture({
      actorId: ACTOR2_ID,
      title: 'foreign',
      keywords: [{ keyword: 'foreign', wholeWord: false }]
    })
    const id = keywordId(keywords, 'foreign')

    const getResponse = await GET(requestFor(id), {
      params: Promise.resolve({ id })
    })
    expect(getResponse.status).toBe(404)

    const putResponse = await PUT(
      requestFor(id, {
        method: 'PUT',
        body: { phrase: 'stolen', context: ['home'] }
      }),
      { params: Promise.resolve({ id }) }
    )
    expect(putResponse.status).toBe(404)

    const deleteResponse = await DELETE(requestFor(id, { method: 'DELETE' }), {
      params: Promise.resolve({ id })
    })
    expect(deleteResponse.status).toBe(404)

    // The other actor's data is untouched.
    const keyword = await database.getFilterKeyword({
      actorId: ACTOR2_ID,
      id
    })
    expect(keyword).toMatchObject({ keyword: 'foreign' })
  })

  it('updates phrase, whole_word and irreversible through the keyword id', async () => {
    const { filter, keywords } = await createFilterFixture({
      title: 'old-phrase',
      keywords: [{ keyword: 'old-phrase', wholeWord: false }]
    })
    const id = keywordId(keywords, 'old-phrase')

    const response = await PUT(
      requestFor(id, {
        method: 'PUT',
        body: {
          phrase: 'new-phrase',
          context: ['home', 'notifications'],
          irreversible: true,
          whole_word: true
        }
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id,
      phrase: 'new-phrase',
      context: ['home', 'notifications'],
      irreversible: true,
      whole_word: true
    })

    const storedFilter = await database.getFilter({
      actorId: ACTOR1_ID,
      id: filter.id
    })
    expect(storedFilter).toMatchObject({
      title: 'new-phrase',
      filterAction: 'hide',
      context: ['home', 'notifications']
    })
    const storedKeyword = await database.getFilterKeyword({
      actorId: ACTOR1_ID,
      id
    })
    expect(storedKeyword).toMatchObject({
      keyword: 'new-phrase',
      wholeWord: true
    })
  })

  it('returns 422 when changing parent attributes of a multi-keyword filter and writes nothing', async () => {
    const { filter, keywords } = await createFilterFixture({
      title: 'guarded-first',
      keywords: [
        { keyword: 'guarded-first', wholeWord: false },
        { keyword: 'guarded-second', wholeWord: false }
      ]
    })
    const id = keywordId(keywords, 'guarded-first')

    const response = await PUT(
      requestFor(id, {
        method: 'PUT',
        body: {
          phrase: 'guarded-first',
          context: ['home'],
          irreversible: true
        }
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(422)
    const storedFilter = await database.getFilter({
      actorId: ACTOR1_ID,
      id: filter.id
    })
    expect(storedFilter).toMatchObject({ filterAction: 'warn' })
  })

  // Exercises the context and expires_in disjuncts of the multi-keyword guard
  // in isolation (the test above only trips the filter_action disjunct). Each
  // body leaves the keyword's own phrase changed so a route that dropped the
  // relevant guard term would return 200 and rename the keyword — proving the
  // 422 here comes from that specific disjunct, not from the phrase change.
  it.each([
    {
      description:
        'returns 422 when changing only the context of a multi-keyword filter and writes nothing',
      title: 'guard-context',
      keyword: 'guard-context-a',
      sibling: 'guard-context-b',
      body: { phrase: 'guard-context-renamed', context: ['home', 'public'] },
      storedFilterMatch: { context: ['home'] }
    },
    {
      description:
        'returns 422 when changing only expires_in of a multi-keyword filter and writes nothing',
      title: 'guard-expiry',
      keyword: 'guard-expiry-a',
      sibling: 'guard-expiry-b',
      body: {
        phrase: 'guard-expiry-renamed',
        context: ['home'],
        expires_in: 3600
      },
      storedFilterMatch: { expiresAt: null }
    }
  ])(
    '$description',
    async ({ title, keyword, sibling, body, storedFilterMatch }) => {
      const { filter, keywords } = await createFilterFixture({
        title,
        keywords: [
          { keyword, wholeWord: false },
          { keyword: sibling, wholeWord: false }
        ]
      })
      const id = keywordId(keywords, keyword)

      const response = await PUT(requestFor(id, { method: 'PUT', body }), {
        params: Promise.resolve({ id })
      })

      expect(response.status).toBe(422)
      // The rejected request renames nothing...
      const storedKeyword = await database.getFilterKeyword({
        actorId: ACTOR1_ID,
        id
      })
      expect(storedKeyword).toMatchObject({ keyword })
      // ...and leaves the shared parent attribute it tried to change intact.
      const storedFilter = await database.getFilter({
        actorId: ACTOR1_ID,
        id: filter.id
      })
      expect(storedFilter).toMatchObject(storedFilterMatch)
    }
  )

  it('allows a whole_word-only toggle on a multi-keyword filter', async () => {
    const { keywords } = await createFilterFixture({
      title: 'toggle-first',
      keywords: [
        { keyword: 'toggle-first', wholeWord: false },
        { keyword: 'toggle-second', wholeWord: false }
      ]
    })
    const id = keywordId(keywords, 'toggle-first')

    const response = await PUT(
      requestFor(id, {
        method: 'PUT',
        body: {
          phrase: 'toggle-first',
          context: ['home'],
          whole_word: true
        }
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      phrase: 'toggle-first',
      whole_word: true,
      irreversible: false
    })
  })

  it('updates a secondary keyword of a multi-keyword filter without touching the shared parent', async () => {
    // The parent title differs from the secondary keyword's phrase, exactly as
    // it does for a v2-created multi-keyword filter. A v1 client must resend the
    // keyword's own current phrase, so input.phrase !== filter.title here.
    const { filter, keywords } = await createFilterFixture({
      title: 'Fruits',
      keywords: [
        { keyword: 'apple', wholeWord: false },
        { keyword: 'banana', wholeWord: false }
      ]
    })
    const id = keywordId(keywords, 'banana')

    const response = await PUT(
      requestFor(id, {
        method: 'PUT',
        body: { phrase: 'banana', context: ['home'], whole_word: true }
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id,
      phrase: 'banana',
      whole_word: true
    })

    const storedKeyword = await database.getFilterKeyword({
      actorId: ACTOR1_ID,
      id
    })
    expect(storedKeyword).toMatchObject({ keyword: 'banana', wholeWord: true })
    // The shared parent title must NOT be overwritten by the keyword's phrase.
    const storedFilter = await database.getFilter({
      actorId: ACTOR1_ID,
      id: filter.id
    })
    expect(storedFilter).toMatchObject({ title: 'Fruits' })
  })

  it('renames a secondary keyword of a multi-keyword filter without changing the parent', async () => {
    const { filter, keywords } = await createFilterFixture({
      title: 'Fruits',
      keywords: [
        { keyword: 'apple', wholeWord: false },
        { keyword: 'banana', wholeWord: false }
      ]
    })
    const id = keywordId(keywords, 'banana')

    const response = await PUT(
      requestFor(id, {
        method: 'PUT',
        body: { phrase: 'berry', context: ['home'] }
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(200)
    const storedKeyword = await database.getFilterKeyword({
      actorId: ACTOR1_ID,
      id
    })
    expect(storedKeyword).toMatchObject({ keyword: 'berry' })
    const storedFilter = await database.getFilter({
      actorId: ACTOR1_ID,
      id: filter.id
    })
    expect(storedFilter).toMatchObject({ title: 'Fruits' })
  })

  it('renames a keyword of a blur-action multi-keyword filter when the v1 irreversible projection is unchanged', async () => {
    // `blur` and `warn` both project to the v1 view's `irreversible: false`
    // (getV1Filter maps irreversible = filterAction === 'hide'). A v1 client
    // echoing the filter's own `irreversible: false` is not changing the
    // v1-visible value, so the multi-keyword guard must allow it. Comparing the
    // derived tri-state filterAction ('warn') against the stored 'blur' used to
    // reject this with a spurious 422.
    const { filter, keywords } = await createFilterFixture({
      title: 'blur-parent',
      filterAction: 'blur',
      keywords: [
        { keyword: 'blur-a', wholeWord: false },
        { keyword: 'blur-b', wholeWord: false }
      ]
    })
    const id = keywordId(keywords, 'blur-a')

    const response = await PUT(
      requestFor(id, {
        method: 'PUT',
        body: { phrase: 'blur-renamed', context: ['home'], irreversible: false }
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id,
      phrase: 'blur-renamed',
      irreversible: false
    })

    const storedKeyword = await database.getFilterKeyword({
      actorId: ACTOR1_ID,
      id
    })
    expect(storedKeyword).toMatchObject({ keyword: 'blur-renamed' })
    // The shared parent filter_action stays 'blur', untouched by the rename.
    const storedFilter = await database.getFilter({
      actorId: ACTOR1_ID,
      id: filter.id
    })
    expect(storedFilter).toMatchObject({ filterAction: 'blur' })
  })

  it('allows a whole_word toggle when the context is reordered but equal on a multi-keyword filter', async () => {
    // The multi-keyword context guard is order-insensitive (contextsDiffer sorts
    // both sides). A v1 client resending the parent's context in a different
    // order changes nothing shared, so the update is allowed. If the sort
    // normalization regressed to an element-wise compare, this would 422 and
    // leave whole_word untouched — the assertion below fails in that case.
    const { keywords } = await createFilterFixture({
      title: 'reorder-parent',
      context: ['home', 'public'],
      keywords: [
        { keyword: 'reorder-a', wholeWord: false },
        { keyword: 'reorder-b', wholeWord: false }
      ]
    })
    const id = keywordId(keywords, 'reorder-a')

    const response = await PUT(
      requestFor(id, {
        method: 'PUT',
        body: {
          phrase: 'reorder-a',
          context: ['public', 'home'],
          whole_word: true
        }
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(200)
    const storedKeyword = await database.getFilterKeyword({
      actorId: ACTOR1_ID,
      id
    })
    expect(storedKeyword).toMatchObject({
      keyword: 'reorder-a',
      wholeWord: true
    })
  })

  it('returns 422 when renaming a keyword to a sibling keyword', async () => {
    const { keywords } = await createFilterFixture({
      // Title matches the target phrase so the multi-keyword guard passes
      // and the duplicate check is what rejects the rename.
      title: 'dup-second',
      keywords: [
        { keyword: 'dup-first', wholeWord: false },
        { keyword: 'dup-second', wholeWord: false }
      ]
    })
    const id = keywordId(keywords, 'dup-first')

    const response = await PUT(
      requestFor(id, {
        method: 'PUT',
        body: { phrase: 'dup-second', context: ['home'] }
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(422)
  })

  it.each([
    {
      description: 'returns 422 when the PUT body is missing phrase',
      body: { context: ['home'] }
    },
    {
      description: 'returns 422 when the PUT body is missing context',
      body: { phrase: 'taboo' }
    }
  ])('$description', async ({ body }) => {
    const { keywords } = await createFilterFixture({
      title: `invalid-${Object.keys(body).join('-')}`,
      keywords: [
        {
          keyword: `invalid-${Object.keys(body).join('-')}`,
          wholeWord: false
        }
      ]
    })
    const id = keywords[0]?.id ?? ''

    const response = await PUT(requestFor(id, { method: 'PUT', body }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(422)
  })

  // Distinct from the field-validation 422s above (well-formed body,
  // parseV1FilterUpdateInput returns null): a malformed application/json body
  // makes parseFilterBody's JSON.parse throw after the ownership 404 check. The
  // route must catch that and return 422 rather than letting the SyntaxError
  // surface as a 500, and the keyword it addresses must be left unchanged. A raw
  // string body is required because the requestFor helper only stringifies valid
  // objects.
  it('returns 422 for a malformed JSON body without writing the keyword', async () => {
    const { keywords } = await createFilterFixture({
      title: 'malformed-update',
      keywords: [{ keyword: 'malformed-update', wholeWord: false }]
    })
    const id = keywordId(keywords, 'malformed-update')

    const response = await PUT(
      new NextRequest(`https://llun.test/api/v1/filters/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://llun.test',
          Referer: 'https://llun.test/'
        },
        body: '{ not json'
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(422)
    const storedKeyword = await database.getFilterKeyword({
      actorId: ACTOR1_ID,
      id
    })
    expect(storedKeyword).toMatchObject({ keyword: 'malformed-update' })
  })

  it('deletes only the keyword when siblings remain', async () => {
    const { filter, keywords } = await createFilterFixture({
      title: 'del-partial',
      keywords: [
        { keyword: 'del-partial-a', wholeWord: false },
        { keyword: 'del-partial-b', wholeWord: false }
      ]
    })
    const id = keywordId(keywords, 'del-partial-a')

    const response = await DELETE(requestFor(id, { method: 'DELETE' }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
    expect(
      await database.getFilterKeyword({ actorId: ACTOR1_ID, id })
    ).toBeNull()
    const remaining = await database.getFilterKeywords({
      actorId: ACTOR1_ID,
      filterId: filter.id
    })
    expect(remaining).toHaveLength(1)
    expect(
      await database.getFilter({ actorId: ACTOR1_ID, id: filter.id })
    ).not.toBeNull()
  })

  it('deletes the parent v2 filter when removing its last keyword', async () => {
    const { filter, keywords } = await createFilterFixture({
      title: 'del-last',
      keywords: [{ keyword: 'del-last', wholeWord: false }]
    })
    const id = keywordId(keywords, 'del-last')

    const response = await DELETE(requestFor(id, { method: 'DELETE' }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    expect(
      await database.getFilterKeyword({ actorId: ACTOR1_ID, id })
    ).toBeNull()
    expect(
      await database.getFilter({ actorId: ACTOR1_ID, id: filter.id })
    ).toBeNull()
  })

  // Rails `resources` maps update to both PATCH and PUT, so v1-era Mastodon
  // clients may send either verb.
  it('binds PATCH to the same handler as PUT', () => {
    expect(typeof PATCH).toBe('function')
    expect(PATCH).toBe(PUT)
  })

  it('advertises PATCH in the OPTIONS Access-Control-Allow-Methods header', async () => {
    const response = await OPTIONS(
      new NextRequest('https://llun.test/api/v1/filters/keyword-1', {
        method: 'OPTIONS',
        headers: { origin: 'https://llun.test' }
      })
    )

    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'PATCH'
    )
  })
})
