import { NextRequest } from 'next/server'

import type { Config } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { deleteServerSetting } from '@/lib/database/testing/fixtures'
import type { Database } from '@/lib/database/types'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'

import { GET } from './route'

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

const KEY = 'policies.privacyPolicy'
const ENV_VAR = 'ACTIVITIES_PRIVACY_POLICY'
const params = { params: Promise.resolve({}) }

describe('GET /api/v1/instance/privacy_policy', () => {
  const { database, db, destroy } = createTestDatabase({ backend: 'sqlite' })
  let savedEnv: string | undefined

  // Stores the policy as an admin saving it at `at` would.
  const storePolicy = async (markdown: string, at: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(at))
    try {
      await database.setServerSettings([{ key: KEY, value: markdown }])
    } finally {
      vi.useRealTimers()
    }
    invalidateServerSettingsCache(database)
  }

  const request = (headers: Record<string, string> = {}) =>
    new NextRequest('https://llun.test/api/v1/instance/privacy_policy', {
      headers
    })

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

  it('renders the stored Markdown with the time it last changed', async () => {
    await storePolicy(
      '## Logs\n\nNo logs & no <trackers>.',
      '2026-03-04T23:30:00.000Z'
    )

    const response = await GET(request(), params)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      updated_at: '2026-03-04T23:30:00.000Z',
      content: '<h2>Logs</h2>\n<p>No logs &amp; no &lt;trackers&gt;.</p>'
    })
  })

  it('fills %{domain} with the domain the request arrived on', async () => {
    await storePolicy('Data on %{domain} stays here.', '2026-03-04T10:00:00Z')

    const body = await (
      await GET(request({ 'x-forwarded-host': 'alias.llun.test' }), params)
    ).json()

    expect(body.content).toBe('<p>Data on alias.llun.test stays here.</p>')
  })

  it('serves an env-pinned policy with the epoch as its date', async () => {
    process.env[ENV_VAR] = 'We keep no logs.'
    invalidateServerSettingsCache(database)

    await expect((await GET(request(), params)).json()).resolves.toEqual({
      updated_at: '1970-01-01T00:00:00.000Z',
      content: '<p>We keep no logs.</p>'
    })
  })

  it.each([
    { description: 'unset', stored: undefined },
    { description: 'empty', stored: '' }
  ])('returns 404 when the policy is $description', async ({ stored }) => {
    if (stored !== undefined) {
      await storePolicy(stored, '2026-03-04T10:00:00.000Z')
    }

    const response = await GET(request(), params)

    expect(response.status).toBe(404)
  })
})
