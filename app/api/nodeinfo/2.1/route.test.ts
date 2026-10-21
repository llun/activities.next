import { NextRequest } from 'next/server'

import type { Config } from '@/lib/config'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  SERVED_DOMAIN_REFRESH_MS,
  refreshServedDomains,
  resetServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'

import { GET } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  buildBaseURL: (host: string) => `https://${host}`
}))

const baseConfig = {
  host: 'llun.test',
  trustedHosts: [],
  serviceName: 'llun test',
  serviceDescription: 'A test instance',
  languages: ['en'],
  registrationOpen: false
}

const params = { params: Promise.resolve({}) }

describe('GET /nodeinfo/2.1', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    // Admin › Instance's name names the node (no longer the config's
    // serviceName).
    await database.setServerSettings([
      { key: 'instance.name', value: 'llun test' }
    ])
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(async () => {
    const config =
      await vi.importMock<typeof import('@/lib/config')>('@/lib/config')
    vi.mocked(config.getConfig).mockReturnValue(baseConfig as unknown as Config)
  })

  it('serves a NodeInfo 2.1 document with the schema content type', async () => {
    const response = await GET(
      new NextRequest('https://llun.test/nodeinfo/2.1'),
      params
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"'
    )
    await expect(response.json()).resolves.toMatchObject({
      version: '2.1',
      protocols: ['activitypub'],
      metadata: { nodeName: 'llun test' }
    })
  })

  it('returns 500 when the database is unavailable', async () => {
    const previous = mockDatabase
    mockDatabase = null
    try {
      const response = await GET(
        new NextRequest('https://llun.test/nodeinfo/2.1'),
        params
      )
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toHaveProperty('error')
    } finally {
      mockDatabase = previous
    }
  })

  it('reports openRegistrations for the domain the request arrived on', async () => {
    const config =
      await vi.importMock<typeof import('@/lib/config')>('@/lib/config')
    vi.mocked(config.getConfig).mockReturnValue({
      ...baseConfig,
      trustedHosts: ['run.llun.test']
    } as unknown as Config)
    await database.createServedDomain({
      domain: 'run.llun.test',
      signupsOpen: true
    })
    try {
      const run = await (
        await GET(
          new NextRequest('https://llun.test/nodeinfo/2.1', {
            headers: { host: 'run.llun.test' }
          }),
          params
        )
      ).json()
      expect(run.openRegistrations).toBe(true)

      await database.updateServedDomain({
        domain: 'run.llun.test',
        signupsOpen: false
      })
      const closed = await (
        await GET(
          new NextRequest('https://llun.test/nodeinfo/2.1', {
            headers: { host: 'run.llun.test' }
          }),
          params
        )
      ).json()
      expect(closed.openRegistrations).toBe(false)
    } finally {
      await database.deleteServedDomain({ domain: 'run.llun.test' })
    }
  })

  // A stale snapshot would not trust the visited Admin › Domains host yet and
  // report the (open) primary's sign-ups instead.
  it('refreshes a stale snapshot before reading the visited host', async () => {
    // Loaded before photos.llun.test was turned on, so it does not list it.
    await refreshServedDomains(database)
    await database.createServedDomain({
      domain: 'photos.llun.test',
      status: 'on',
      signupsOpen: false
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + SERVED_DOMAIN_REFRESH_MS + 1)
    try {
      const body = await (
        await GET(
          new NextRequest('https://llun.test/nodeinfo/2.1', {
            headers: { host: 'photos.llun.test' }
          }),
          params
        )
      ).json()
      expect(body.openRegistrations).toBe(false)
    } finally {
      vi.useRealTimers()
      resetServedDomainsForTests()
      await database.deleteServedDomain({ domain: 'photos.llun.test' })
    }
  })
})
