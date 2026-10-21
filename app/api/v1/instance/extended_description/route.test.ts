import { NextRequest } from 'next/server'

import type { Config } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { invalidateDomainIdentityCache } from '@/lib/services/domains/domainIdentity'
import { resetServedDomainsForTests } from '@/lib/services/domains/servedDomainSnapshot'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'

import { GET } from './route'

const holder = vi.hoisted(() => ({ db: null as Database | null }))
vi.mock('@/lib/database', () => ({
  getDatabase: () => holder.db
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

const baseConfig = {
  host: 'llun.test',
  trustedHosts: ['alias.llun.test'],
  serviceDescription: 'From the env config'
}

const params = { params: Promise.resolve({}) }

const visit = async (host: string) =>
  (
    await GET(
      new NextRequest(
        'https://llun.test/api/v1/instance/extended_description',
        {
          headers: { host }
        }
      ),
      params
    )
  ).json()

describe('GET /api/v1/instance/extended_description', () => {
  const { database } = createTestDatabase({ backend: 'sqlite' })

  beforeAll(async () => {
    await database.migrate()
    holder.db = database
  })

  afterAll(async () => {
    holder.db = null
    await database.destroy()
  })

  beforeEach(async () => {
    const config =
      await vi.importMock<typeof import('@/lib/config')>('@/lib/config')
    vi.mocked(config.getConfig).mockReturnValue(baseConfig as unknown as Config)
    resetServedDomainsForTests()
    invalidateServerSettingsCache(database)
    invalidateDomainIdentityCache(database)
  })

  it('serves the server description from Admin › Instance, escaped', async () => {
    await database.setServerSettings([
      { key: 'instance.description', value: 'Runs & rides <here>' }
    ])
    invalidateServerSettingsCache(database)

    await expect(visit('llun.test')).resolves.toEqual({
      updated_at: '1970-01-01T00:00:00.000Z',
      content: '<p>Runs &amp; rides &lt;here&gt;</p>'
    })
  })

  it('serves the visited domain’s own description', async () => {
    await database.createServedDomain({
      domain: 'alias.llun.test',
      description: 'The alias'
    })
    await expect(visit('alias.llun.test')).resolves.toMatchObject({
      content: '<p>The alias</p>'
    })
  })

  it('answers empty content when there is no description', async () => {
    await database.setServerSettings([
      { key: 'instance.description', value: '' }
    ])
    invalidateServerSettingsCache(database)
    await expect(visit('llun.test')).resolves.toMatchObject({ content: '' })
  })
})
