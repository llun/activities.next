import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { DELETE, GET, PATCH, PUT } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => null
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi
    .fn()
    .mockResolvedValue({ user: { email: 'admin@llun.test' } })
}))

const mockGetAdminFromSession = vi.fn()
vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: () => mockGetAdminFromSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('/api/v2/admin/filters/:id', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAdminFromSession.mockResolvedValue({
      id: 'admin',
      email: 'admin@llun.test'
    })
  })

  const request = (id: string, method: string, body?: string) =>
    new NextRequest(`https://llun.test/api/v2/admin/filters/${id}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://llun.test',
        Referer: 'https://llun.test/'
      },
      body
    })
  const context = (id: string) => ({ params: Promise.resolve({ id }) })

  const createServerFilter = (title: string, words: string[] = ['spam']) =>
    database.createServerFilter({
      title,
      context: ['home', 'public'],
      filterAction: 'hide',
      expiresAt: null,
      keywords: words.map((keyword) => ({ keyword, wholeWord: false }))
    })

  it.each([
    { method: 'GET', handler: GET },
    { method: 'PUT', handler: PUT },
    { method: 'PATCH', handler: PATCH },
    { method: 'DELETE', handler: DELETE }
  ])(
    'rejects a non-admin $method and leaves the filter intact',
    async ({ method, handler }) => {
      mockGetAdminFromSession.mockResolvedValue(null)
      const filter = await createServerFilter(`guarded-${method}`)

      const response = await handler(
        request(
          filter.id,
          method,
          method === 'PUT' || method === 'PATCH'
            ? JSON.stringify({ title: 'hijacked' })
            : undefined
        ),
        context(filter.id)
      )

      expect(response.status).toBe(403)
      expect(
        (await database.getServerFilterRecord({ id: filter.id }))?.filter
      ).toMatchObject({
        title: `guarded-${method}`
      })
    }
  )

  describe('GET', () => {
    it('returns the server filter with its keywords and the server flag', async () => {
      const filter = await createServerFilter('admin-get', ['alpha', 'beta'])

      const response = await GET(request(filter.id, 'GET'), context(filter.id))

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({
        id: filter.id,
        title: 'admin-get',
        context: ['home', 'public'],
        filter_action: 'hide',
        expires_at: null,
        server: true,
        statuses: []
      })
      expect(
        body.keywords.map((k: { keyword: string }) => k.keyword).sort()
      ).toEqual(['alpha', 'beta'])
    })

    it('answers 404 for an unknown id', async () => {
      const response = await GET(request('missing', 'GET'), context('missing'))

      expect(response.status).toBe(404)
    })
  })

  describe('PUT / PATCH', () => {
    it.each([
      { method: 'PUT', handler: PUT },
      { method: 'PATCH', handler: PATCH }
    ])(
      'updates the fields sent and keeps the rest when sent as $method',
      async ({ method, handler }) => {
        const filter = await createServerFilter(`admin-${method}`)

        const response = await handler(
          request(
            filter.id,
            method,
            JSON.stringify({
              title: `renamed-${method}`,
              filter_action: 'warn'
            })
          ),
          context(filter.id)
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          id: filter.id,
          title: `renamed-${method}`,
          filter_action: 'warn',
          context: ['home', 'public'],
          server: true
        })
        expect(
          (await database.getServerFilterRecord({ id: filter.id }))?.filter
        ).toMatchObject({
          title: `renamed-${method}`,
          filterAction: 'warn',
          context: ['home', 'public']
        })
      }
    )

    it('adds and removes keywords through keywords_attributes', async () => {
      const filter = await createServerFilter('admin-keywords', ['old'])
      const [old] = (await database.getServerFilterKeywords({ id: filter.id }))!

      const response = await PUT(
        request(
          filter.id,
          'PUT',
          JSON.stringify({
            keywords_attributes: [
              { id: old.id, _destroy: true },
              { keyword: 'fresh', whole_word: true }
            ]
          })
        ),
        context(filter.id)
      )

      expect(response.status).toBe(200)
      expect(
        (await database.getServerFilterKeywords({ id: filter.id }))?.map(
          (k) => ({ keyword: k.keyword, wholeWord: k.wholeWord })
        )
      ).toEqual([{ keyword: 'fresh', wholeWord: true }])
    })

    it('clears the expiry when expires_in is empty', async () => {
      const filter = await database.createServerFilter({
        title: 'admin-expiring',
        context: ['home'],
        filterAction: 'warn',
        expiresAt: Date.now() + 60_000,
        keywords: []
      })

      const response = await PUT(
        request(filter.id, 'PUT', JSON.stringify({ expires_in: '' })),
        context(filter.id)
      )

      expect(response.status).toBe(200)
      expect((await response.json()).expires_at).toBeNull()
    })

    it.each([
      { description: 'a blank title', body: JSON.stringify({ title: ' ' }) },
      {
        description: 'an empty context',
        body: JSON.stringify({ context: [] })
      },
      { description: 'malformed JSON', body: '{' }
    ])('answers 422 and changes nothing for $description', async ({ body }) => {
      const filter = await createServerFilter('admin-invalid')

      const response = await PUT(
        request(filter.id, 'PUT', body),
        context(filter.id)
      )

      expect(response.status).toBe(422)
      expect(
        (await database.getServerFilterRecord({ id: filter.id }))?.filter
      ).toMatchObject({
        title: 'admin-invalid'
      })
    })

    it('answers 404 for an unknown id', async () => {
      const response = await PUT(
        request('missing', 'PUT', JSON.stringify({ title: 'x' })),
        context('missing')
      )

      expect(response.status).toBe(404)
    })
  })

  describe('DELETE', () => {
    it('deletes the server filter', async () => {
      const filter = await createServerFilter('admin-delete')

      const response = await DELETE(
        request(filter.id, 'DELETE'),
        context(filter.id)
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
      expect(await database.getServerFilterRecord({ id: filter.id })).toBeNull()
    })

    it('answers 404 for an unknown id', async () => {
      const response = await DELETE(
        request('missing', 'DELETE'),
        context('missing')
      )

      expect(response.status).toBe(404)
    })
  })
})
