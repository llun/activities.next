import { NextRequest } from 'next/server'

import type { Config } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { deleteServerSetting } from '@/lib/database/testing/fixtures'
import type { Database } from '@/lib/database/types'
import { invalidateDomainIdentityCache } from '@/lib/services/domains/domainIdentity'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'

import { GET as GET_BY_DATE } from './[date]/route'
import { GET } from './route'

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

const KEY = 'policies.termsOfService'
const ENV_VAR = 'ACTIVITIES_TERMS_OF_SERVICE'
const params = { params: Promise.resolve({}) }

describe('GET /api/v1/instance/terms_of_service', () => {
  const { database, db, destroy } = createTestDatabase({ backend: 'sqlite' })
  let savedEnv: string | undefined

  // Stores the terms as an admin saving them at `at` would.
  const storeTerms = async (markdown: string, at: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(at))
    try {
      await database.setServerSettings([{ key: KEY, value: markdown }])
    } finally {
      vi.useRealTimers()
    }
    invalidateServerSettingsCache(database)
  }

  const request = (path = '', headers: Record<string, string> = {}) =>
    new NextRequest(
      `https://llun.test/api/v1/instance/terms_of_service${path}`,
      {
        headers
      }
    )

  const requestByDate = (date: string) =>
    GET_BY_DATE(request(`/${date}`), { params: Promise.resolve({ date }) })

  beforeAll(async () => {
    await database.migrate()
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await destroy()
  })

  beforeEach(async () => {
    savedEnv = process.env[ENV_VAR]
    delete process.env[ENV_VAR]
    const config =
      await vi.importMock<typeof import('@/lib/config')>('@/lib/config')
    vi.mocked(config.getConfig).mockReturnValue({
      host: 'llun.test',
      trustedHosts: ['alias.llun.test']
    } as unknown as Config)
    invalidateServerSettingsCache(database)
  })

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env[ENV_VAR]
    else process.env[ENV_VAR] = savedEnv
    await deleteServerSetting(db, { key: KEY })
    invalidateServerSettingsCache(database)
  })

  it('renders the stored Markdown, dated the day it last changed (UTC)', async () => {
    await storeTerms('**Be excellent** & <fair>', '2026-03-04T23:30:00.000Z')

    const response = await GET(request(), params)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      effective_date: '2026-03-04',
      effective: true,
      content: '<p><strong>Be excellent</strong> &amp; &lt;fair&gt;</p>',
      succeeded_by: null
    })
  })

  it('keeps the date when the same text is saved again', async () => {
    await storeTerms('Be excellent', '2026-03-04T10:00:00.000Z')
    await storeTerms('Be excellent', '2026-05-06T10:00:00.000Z')

    const body = await (await GET(request(), params)).json()

    expect(body.effective_date).toBe('2026-03-04')
  })

  it('splits paragraphs on blank lines', async () => {
    await storeTerms('First rule.\n\nSecond rule.', '2026-03-04T10:00:00.000Z')

    const body = await (await GET(request(), params)).json()

    expect(body.content).toBe('<p>First rule.</p>\n<p>Second rule.</p>')
  })

  it('fills %{domain} with the domain the request arrived on', async () => {
    await storeTerms('Welcome to %{domain}.', '2026-03-04T10:00:00.000Z')

    const body = await (
      await GET(request('', { 'x-forwarded-host': 'alias.llun.test' }), params)
    ).json()

    expect(body.content).toBe('<p>Welcome to alias.llun.test.</p>')
  })

  it('serves the visited domain’s own terms, dated when they last changed', async () => {
    await storeTerms('Server terms', '2026-03-04T10:00:00.000Z')
    invalidateDomainIdentityCache(database)
    await database.createServedDomain({
      domain: 'alias.llun.test',
      termsOfService: 'Alias terms for %{domain}',
      termsOfServiceUpdatedAt: Date.UTC(2026, 6, 8, 9)
    })
    try {
      const alias = await (
        await GET(request('', { host: 'alias.llun.test' }), params)
      ).json()
      expect(alias).toMatchObject({
        effective_date: '2026-07-08',
        content: '<p>Alias terms for alias.llun.test</p>'
      })
      const dated = await GET_BY_DATE(
        new NextRequest(
          'https://llun.test/api/v1/instance/terms_of_service/2026-07-08',
          { headers: { host: 'alias.llun.test' } }
        ),
        { params: Promise.resolve({ date: '2026-07-08' }) }
      )
      expect(dated.status).toBe(200)
      await expect(dated.json()).resolves.toMatchObject({
        effective_date: '2026-07-08',
        content: '<p>Alias terms for alias.llun.test</p>'
      })
      // The server's date belongs to the server's terms, not this domain's.
      const serverDate = await GET_BY_DATE(
        new NextRequest(
          'https://llun.test/api/v1/instance/terms_of_service/2026-03-04',
          { headers: { host: 'alias.llun.test' } }
        ),
        { params: Promise.resolve({ date: '2026-03-04' }) }
      )
      expect(serverDate.status).toBe(404)
      // And the domain's date is unknown on the primary.
      const onPrimary = await GET_BY_DATE(
        new NextRequest(
          'https://llun.test/api/v1/instance/terms_of_service/2026-07-08'
        ),
        { params: Promise.resolve({ date: '2026-07-08' }) }
      )
      expect(onPrimary.status).toBe(404)

      // The primary keeps the server's.
      const primary = await (await GET(request(), params)).json()
      expect(primary.content).toBe('<p>Server terms</p>')
    } finally {
      await database.deleteServedDomain({ domain: 'alias.llun.test' })
      invalidateDomainIdentityCache(database)
    }
  })

  it('serves env-pinned terms with the epoch as their effective date', async () => {
    process.env[ENV_VAR] = 'Pinned terms'
    invalidateServerSettingsCache(database)

    const body = await (await GET(request(), params)).json()

    expect(body).toMatchObject({
      effective_date: '1970-01-01',
      content: '<p>Pinned terms</p>'
    })
  })

  it.each([
    { description: 'unset', stored: undefined },
    { description: 'empty', stored: '' },
    { description: 'blank', stored: '  \n\n ' }
  ])('returns 404 when the terms are $description', async ({ stored }) => {
    if (stored !== undefined) {
      await storeTerms(stored, '2026-03-04T10:00:00.000Z')
    }

    const response = await GET(request(), params)

    expect(response.status).toBe(404)
  })

  it('treats an empty env variable as unset', async () => {
    process.env[ENV_VAR] = ''
    await storeTerms('Stored terms', '2026-03-04T10:00:00.000Z')

    const body = await (await GET(request(), params)).json()

    expect(body.content).toBe('<p>Stored terms</p>')
  })

  describe('by effective date', () => {
    it('serves the current version by its effective date', async () => {
      await storeTerms('Be excellent', '2026-03-04T10:00:00.000Z')

      const response = await requestByDate('2026-03-04')

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        effective_date: '2026-03-04',
        effective: true,
        content: '<p>Be excellent</p>'
      })
    })

    it.each([
      {
        description: 'an unknown effective date',
        stored: 'Be excellent',
        date: '1970-01-01'
      },
      {
        description: 'no terms',
        stored: undefined,
        date: '2026-03-04'
      }
    ])('returns 404 for $description', async ({ stored, date }) => {
      if (stored !== undefined) {
        await storeTerms(stored, '2026-03-04T10:00:00.000Z')
      }

      const response = await requestByDate(date)

      expect(response.status).toBe(404)
    })
  })
})
