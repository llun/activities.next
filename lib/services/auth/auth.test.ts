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
    await testDb.prepareEmpty()
    holder.testDb = testDb
  })

  afterAll(async () => {
    resetServedDomainsForTests()
    await holder.testDb?.destroy()
  })

  // Asked per request, so a domain turned on or off in Admin › Served domains is
  // trusted, or not, without rebuilding the cached instance.
  it('follows the active Admin › Served domains rows', async () => {
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

type PluginWithOptions = { id: string; options?: Record<string, unknown> }

const pluginOptions = (
  auth: { options: { plugins?: unknown[] } },
  id: string
): Record<string, unknown> | undefined =>
  (auth.options.plugins as PluginWithOptions[] | undefined)?.find(
    (plugin) => plugin.id === id
  )?.options

describe('getAuth per-domain names', () => {
  beforeAll(async () => {
    const testDb = createTestDatabase()
    await testDb.prepareEmpty()
    holder.testDb = testDb
  })

  afterAll(async () => {
    await holder.testDb?.destroy()
    holder.testDb = null
  })

  // The name is a label only: rpID stays the host, so passkeys saved before a
  // rename still match.
  it('labels the passkey relying party and the 2FA issuer with the name', async () => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    const auth = getAuth('https://run.example', 'Run Club')

    expect(pluginOptions(auth, 'passkey')).toMatchObject({
      rpID: 'run.example',
      rpName: 'Run Club',
      origin: 'https://run.example'
    })
    expect(pluginOptions(auth, 'two-factor')).toMatchObject({
      issuer: 'Run Club'
    })
  })

  it('drops colons and control characters from the 2FA issuer only', async () => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    const auth = getAuth('https://colon.example', 'Run: Club\n')

    expect(pluginOptions(auth, 'passkey')).toMatchObject({
      rpName: 'Run: Club\n'
    })
    expect(pluginOptions(auth, 'two-factor')).toMatchObject({
      issuer: 'Run Club'
    })
  })

  it('keeps the configured name when called without one', async () => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    const auth = getAuth()

    expect(pluginOptions(auth, 'passkey')).toMatchObject({
      rpID: 'test.example.com',
      rpName: 'Activities.next Test'
    })
    expect(getAuth('https://test.example.com', 'Activities.next Test')).toBe(
      auth
    )
  })

  it('caches one instance per base URL and name', async () => {
    const { getAuth } = await import('@/lib/services/auth/auth')
    const first = getAuth('https://cache.example', 'Run Club')

    expect(getAuth('https://cache.example', 'Run Club')).toBe(first)
    expect(getAuth('https://cache.example', 'Renamed Club')).not.toBe(first)
    expect(getAuth('https://other.example', 'Run Club')).not.toBe(first)
  })

  // A wildcard trusted host and admin renames both add keys; the cache must
  // stay bounded and drop the least recently used one.
  it('evicts the least recently used instance past the cap', async () => {
    const { MAX_AUTH_INSTANCES, getAuth } =
      await import('@/lib/services/auth/auth')
    const kept = getAuth('https://lru.example', 'Kept')
    const dropped = getAuth('https://lru.example', 'Dropped')
    // Touch `kept` so `dropped` is now the older of the two.
    expect(getAuth('https://lru.example', 'Kept')).toBe(kept)

    for (let index = 0; index < MAX_AUTH_INSTANCES - 1; index += 1) {
      getAuth(`https://fill-${index}.example`, 'Filler')
    }

    expect(getAuth('https://lru.example', 'Kept')).toBe(kept)
    expect(getAuth('https://lru.example', 'Dropped')).not.toBe(dropped)
  })
})
