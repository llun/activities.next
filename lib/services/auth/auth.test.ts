import {
  type TestDatabase,
  createTestDatabase
} from '@/lib/database/testing/createTestDatabase'
import {
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'

const holder = vi.hoisted(() => ({ testDb: null as TestDatabase | null }))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'test.example.com',
    serviceName: 'Activities.next Test',
    // Long enough that better-auth does not warn about a weak secret.
    secretPhase: 'test-secret-phrase-that-is-long-enough-1234567890',
    trustedHosts: ['alias.example.com']
  }),
  getBaseURL: () => 'https://test.example.com'
}))

vi.mock('@/lib/database', () => ({
  getKysely: () => holder.testDb?.db,
  getDatabase: () => null
}))

describe('getAuth trustedOrigins', () => {
  beforeAll(async () => {
    const testDb = createTestDatabase()
    await testDb.prepare()
    holder.testDb = testDb
  })

  afterAll(async () => {
    resetServedDomainsForTests()
    await holder.testDb?.destroy()
  })

  // Asked per request, so a domain turned on or off in Admin › Domains is
  // trusted, or not, without rebuilding the cached instance.
  it('follows the active Admin › Domains rows', async () => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    const { trustedOrigins } = getAuth('https://test.example.com').options
    if (typeof trustedOrigins !== 'function') {
      throw new Error('trustedOrigins is not resolved per request')
    }

    setServedDomainsForTests(['run.example'])
    expect(await trustedOrigins()).toEqual([
      'https://test.example.com',
      'https://alias.example.com',
      'https://run.example'
    ])

    setServedDomainsForTests([])
    expect(await trustedOrigins()).toEqual([
      'https://test.example.com',
      'https://alias.example.com'
    ])
  })
})
