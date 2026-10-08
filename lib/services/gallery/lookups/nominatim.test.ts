import { getConfig } from '@/lib/config'
import { DEFAULT_NOMINATIM_ENDPOINT } from '@/lib/config/gallery'

import nominatimNone from './__fixtures__/nominatim-reverse-none.json'
import nominatimThailand from './__fixtures__/nominatim-reverse-th.json'
import {
  StubHandler,
  createFakeLookupDatabase,
  createStubFetch,
  createTestProvider
} from './lookupTestUtils'
import {
  createNominatimClient,
  nominatimProvider,
  snapPoint
} from './nominatim'
import { createCircuitBreaker, createLimiter } from './rateLimit'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

const ENDPOINT = 'https://nominatim.test'

// The photo's real point. It must never appear in a request or a cache key.
const RAW = { latitude: 14.534709, longitude: 101.391256 }

const setup = ({
  handler = (() => ({ body: nominatimThailand })) as StubHandler,
  email = null as string | null,
  endpoint = ENDPOINT,
  skipCachedMiss = false,
  db = createFakeLookupDatabase()
} = {}) => {
  const stub = createStubFetch(handler)
  const provider = createTestProvider({
    name: 'Nominatim',
    limiter: createLimiter({ maxConcurrent: 1, minIntervalMs: 0 }),
    breaker: createCircuitBreaker()
  })
  const client = createNominatimClient({
    database: db.database,
    fetch: stub.fetch,
    provider,
    endpoint,
    email,
    skipCachedMiss
  })
  return { client, provider, ...stub, ...db }
}

describe('nominatim client', () => {
  beforeEach(() => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      languages: ['en'],
      gallery: { nominatim: { endpoint: ENDPOINT, email: null } }
    } as never)
  })

  it('snaps to the 0.05 degree cell centre', () => {
    expect(snapPoint(RAW)).toEqual({ latitude: 14.55, longitude: 101.4 })
    expect(snapPoint({ latitude: -33.8688, longitude: 151.2093 })).toEqual({
      latitude: -33.85,
      longitude: 151.2
    })
  })

  it('asks Nominatim for the cell centre, never the stored point', async () => {
    const { client, requests, rows } = setup()

    await client.reverseGeocode(RAW)

    expect(requests).toHaveLength(1)
    const { url } = requests[0]
    expect(url.origin + url.pathname).toBe(`${ENDPOINT}/reverse`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: 'jsonv2',
      lat: '14.55',
      lon: '101.40',
      zoom: '10',
      addressdetails: '1'
    })

    // Nothing about the real point leaks into the URL, the headers or the cache.
    const everything = JSON.stringify([
      url.toString(),
      requests[0].headers,
      [...rows.entries()]
    ])
    for (const fragment of ['14.5347', '101.3912', '14.53', '101.39']) {
      expect(everything).not.toContain(fragment)
    }
  })

  it('sends the User-Agent, language and the contact email', async () => {
    const { client, requests } = setup({ email: 'ops@example.com' })

    await client.reverseGeocode(RAW)

    expect(requests[0].method).toBe('GET')
    expect(requests[0].headers['User-Agent']).toMatch(
      /^activities\.next\/\S+ \(\+https:\/\/llun\.test\)$/
    )
    expect(requests[0].headers['Accept-Language']).toBe('en')
    expect(requests[0].url.searchParams.get('email')).toBe('ops@example.com')
    expect(requests[0].connectTimeoutInMilliseconds).toBe(2_000)
  })

  it('returns the formatted name and country code', async () => {
    const { client } = setup()
    await expect(client.reverseGeocode(RAW)).resolves.toEqual({
      name: 'หมูสี, ประเทศไทย',
      countryCode: 'TH'
    })
  })

  it('shares one request and one cache row between points in a cell', async () => {
    const { client, requests, rows } = setup()

    await client.reverseGeocode(RAW)
    await client.reverseGeocode({ latitude: 14.56, longitude: 101.42 })

    expect(requests).toHaveLength(1)
    // A self-hosted endpoint's rows carry a tag of their own.
    expect([...rows.keys()]).toEqual([
      expect.stringMatching(/^geocode:@[0-9a-f]{12}\|en:14\.55,101\.40$/)
    ])
  })

  it('keys the public endpoint’s rows without a tag', async () => {
    const { client, rows } = setup({ endpoint: DEFAULT_NOMINATIM_ENDPOINT })

    await client.reverseGeocode(RAW)

    expect([...rows.keys()]).toEqual(['geocode:en:14.55,101.40'])
  })

  // A regional Nominatim has no name outside its import; switching back to
  // the public one must not keep serving that miss.
  it('does not share a cached miss between endpoints', async () => {
    const db = createFakeLookupDatabase()
    const regional = setup({
      db,
      endpoint: 'https://nominatim.example.th',
      handler: () => ({ body: nominatimNone })
    })
    await expect(regional.client.reverseGeocode(RAW)).resolves.toBeNull()

    const fixed = setup({ db, endpoint: DEFAULT_NOMINATIM_ENDPOINT })
    await expect(fixed.client.reverseGeocode(RAW)).resolves.toMatchObject({
      countryCode: 'TH'
    })
    expect(fixed.requests).toHaveLength(1)
    expect(db.rows.size).toBe(2)
  })

  it('asks again past a cached miss with skipCachedMiss (Retry, backfill)', async () => {
    const db = createFakeLookupDatabase()
    const first = setup({ db, handler: () => ({ body: nominatimNone }) })
    await expect(first.client.reverseGeocode(RAW)).resolves.toBeNull()

    const cached = setup({ db })
    await expect(cached.client.reverseGeocode(RAW)).resolves.toBeNull()
    expect(cached.requests).toHaveLength(0)

    const retry = setup({ db, skipCachedMiss: true })
    await expect(retry.client.reverseGeocode(RAW)).resolves.toMatchObject({
      countryCode: 'TH'
    })
    expect(retry.requests).toHaveLength(1)
  })

  it('answers null (and caches the miss) when Nominatim has no name', async () => {
    const { client, requests } = setup({
      handler: () => ({ body: nominatimNone })
    })

    await expect(client.reverseGeocode(RAW)).resolves.toBeNull()
    await expect(client.reverseGeocode(RAW)).resolves.toBeNull()
    expect(requests).toHaveLength(1)
  })

  it.each([
    ['no address and no error', { place_id: 1, display_name: 'Somewhere' }],
    ['a list', []],
    ['a string', 'nope']
  ])('throws a parse error for an answer with %s', async (_, body) => {
    const { client, rows } = setup({ handler: () => ({ body }) })

    await expect(client.reverseGeocode(RAW)).rejects.toMatchObject({
      code: 'parse'
    })
    expect([...rows.values()][0]?.outcome).toBe('error')
  })

  // A 404 is a wrong endpoint (Nominatim's "nothing here" is a 200), so it
  // must not be cached as a cell with no name.
  it('throws an http error for a 404, and caches no miss', async () => {
    const { client, rows } = setup({
      handler: () => ({ statusCode: 404, body: '<html>Not Found</html>' })
    })

    await expect(client.reverseGeocode(RAW)).rejects.toMatchObject({
      code: 'http'
    })
    expect([...rows.values()][0]?.outcome).toBe('error')
  })

  it('does not cache a fail-fast open circuit', async () => {
    const { client, rows, provider } = setup({
      handler: () => ({ body: nominatimNone })
    })
    provider.breaker.open()

    await expect(client.reverseGeocode(RAW)).rejects.toMatchObject({
      code: 'circuit-open'
    })
    expect(rows.size).toBe(0)
  })

  it('opens the circuit on a 429 and then fails fast without a request', async () => {
    const { client, requests, provider } = setup({
      handler: () => ({ statusCode: 429, headers: { 'retry-after': '60' } })
    })

    await expect(client.reverseGeocode(RAW)).rejects.toMatchObject({
      code: 'unavailable'
    })
    expect(provider.breaker.isOpen()).toBe(true)

    await expect(
      client.reverseGeocode({ latitude: 48.85, longitude: 2.35 })
    ).rejects.toMatchObject({ code: 'circuit-open' })
    expect(requests).toHaveLength(1)
  })

  it('opens the circuit on a timeout', async () => {
    const { client, provider } = setup({
      handler: () =>
        Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
    })

    await expect(client.reverseGeocode(RAW)).rejects.toMatchObject({
      code: 'network'
    })
    expect(provider.breaker.isOpen()).toBe(true)
  })

  it('has a 64 KiB body cap, and refuses a bigger answer', async () => {
    expect(nominatimProvider.maxBodyBytes).toBe(64 * 1024)
    expect(nominatimProvider.timeoutMs).toBe(5_000)
    expect(nominatimProvider.connectTimeoutMs).toBe(2_000)

    const stub = createStubFetch(() => ({ body: 'x'.repeat(70 * 1024) }))
    const client = createNominatimClient({
      database: createFakeLookupDatabase().database,
      fetch: stub.fetch,
      provider: createTestProvider({ maxBodyBytes: 64 * 1024 }),
      endpoint: ENDPOINT,
      email: null
    })

    await expect(client.reverseGeocode(RAW)).rejects.toMatchObject({
      code: 'network'
    })
  })

  describe('rate limit', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('keeps calls at least 1.1 s apart and fails a caller who would wait over 10 s', async () => {
      const starts: number[] = []
      const stub = createStubFetch(() => {
        starts.push(Date.now())
        return { body: nominatimThailand }
      })
      const db = createFakeLookupDatabase()
      const provider = {
        ...nominatimProvider,
        limiter: createLimiter({
          maxConcurrent: 1,
          minIntervalMs: 1100,
          maxWaitMs: 10_000
        }),
        breaker: createCircuitBreaker()
      }
      const client = createNominatimClient({
        database: db.database,
        fetch: stub.fetch,
        provider,
        endpoint: ENDPOINT,
        email: null
      })

      // Distinct cells so none is served from the cache.
      const calls = Array.from({ length: 10 }, (_, index) =>
        client.reverseGeocode({ latitude: 10 + index, longitude: 100 })
      )
      // The 11th would start 11 s from now.
      const over = client.reverseGeocode({ latitude: 30, longitude: 100 })
      const overResult = over.catch((error) => error)

      await vi.advanceTimersByTimeAsync(11_000)
      await Promise.all(calls)

      expect(await overResult).toMatchObject({ code: 'rate-limited' })
      const gaps = starts.slice(1).map((start, index) => start - starts[index])
      expect(gaps.every((gap) => gap >= 1100)).toBe(true)
    })

    // The race: calls already waiting for their turn when the first one
    // opened the circuit used to go out anyway.
    it('does not send calls that queued before the circuit opened', async () => {
      const stub = createStubFetch(() =>
        Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
      )
      const provider = {
        ...nominatimProvider,
        limiter: createLimiter({
          maxConcurrent: 1,
          minIntervalMs: 1100,
          maxWaitMs: 10_000
        }),
        breaker: createCircuitBreaker()
      }
      const client = createNominatimClient({
        database: createFakeLookupDatabase().database,
        fetch: stub.fetch,
        provider,
        endpoint: ENDPOINT,
        email: null
      })

      const results = [10, 11, 12].map((latitude) =>
        client
          .reverseGeocode({ latitude, longitude: 100 })
          .catch((error) => error)
      )
      await vi.advanceTimersByTimeAsync(5_000)

      expect(await Promise.all(results)).toMatchObject([
        { code: 'network' },
        { code: 'circuit-open' },
        { code: 'circuit-open' }
      ])
      expect(stub.requests).toHaveLength(1)
    })
  })
})
