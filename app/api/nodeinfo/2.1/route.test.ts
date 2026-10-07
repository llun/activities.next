import { NextRequest } from 'next/server'

import type { Config } from '@/lib/config'
import { getTestSQLDatabase } from '@/lib/database/testUtils'

import { GET } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => null
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
})
