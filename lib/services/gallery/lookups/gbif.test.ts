import { getConfig } from '@/lib/config'

import iucnEndangered from './__fixtures__/gbif-iucn-en.json'
import iucnLeastConcern from './__fixtures__/gbif-iucn-lc.json'
import matchExact from './__fixtures__/gbif-match-exact.json'
import matchGenus from './__fixtures__/gbif-match-genus.json'
import matchNone from './__fixtures__/gbif-match-none.json'
import matchSynonym from './__fixtures__/gbif-match-synonym.json'
import matchTiger from './__fixtures__/gbif-match-tiger.json'
import searchKingfisher from './__fixtures__/gbif-search-kingfisher.json'
import taxonKingfisher from './__fixtures__/gbif-taxon-kingfisher.json'
import taxonTiger from './__fixtures__/gbif-taxon-tiger.json'
import { createGbifClient } from './gbif'
import { LookupError } from './lookupRequest'
import {
  StubResponse,
  createFakeLookupDatabase,
  createStubFetch,
  createTestProvider
} from './lookupTestUtils'
import { createCircuitBreaker, createLimiter } from './rateLimit'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

const ENDPOINT = 'https://gbif.test/v1'

// The GBIF API as recorded fixtures, keyed by the path after the endpoint.
const gbifApi = (url: URL): StubResponse => {
  const path = url.pathname.replace('/v1/', '')
  if (path === 'species/match') {
    const name = url.searchParams.get('name')
    if (name === 'Alcedo atthis') return { body: matchExact }
    if (name === 'Parus caeruleus') return { body: matchSynonym }
    if (name === 'Alcedo') return { body: matchGenus }
    if (name === 'Panthera tigris') return { body: matchTiger }
    return { body: matchNone }
  }
  if (path === 'species/2475532') return { body: taxonKingfisher }
  if (path === 'species/2475532/iucnRedListCategory') {
    return { body: iucnLeastConcern }
  }
  if (path === 'species/5219416') return { body: taxonTiger }
  if (path === 'species/5219416/iucnRedListCategory') {
    return { body: iucnEndangered }
  }
  if (path === 'species/2487879') {
    return {
      body: {
        ...taxonKingfisher,
        key: 2487879,
        nubKey: 2487879,
        canonicalName: 'Cyanistes caeruleus',
        scientificName: 'Cyanistes caeruleus (Linnaeus, 1758)'
      }
    }
  }
  if (path === 'species/2487879/iucnRedListCategory') {
    return { body: iucnLeastConcern }
  }
  if (path === 'species/search') return { body: searchKingfisher }
  return { statusCode: 404 }
}

const setup = (handler: (url: URL) => StubResponse | Error = gbifApi) => {
  const stub = createStubFetch((request) => handler(request.url))
  const db = createFakeLookupDatabase()
  const provider = createTestProvider({ name: 'GBIF' })
  const client = createGbifClient({
    database: db.database,
    fetch: stub.fetch,
    provider,
    endpoint: ENDPOINT
  })
  return { client, provider, ...stub, ...db }
}

describe('gbif client', () => {
  beforeEach(() => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'llun.test',
      languages: ['th', 'en'],
      gallery: { gbif: { endpoint: ENDPOINT } }
    } as never)
  })

  describe('matchTaxon', () => {
    it('matches a name and sends the identifying headers and no credentials', async () => {
      const { client, requests } = setup()

      await expect(client.matchTaxon('Alcedo atthis')).resolves.toEqual({
        taxonKey: '2475532',
        scientificName: 'Alcedo atthis',
        rank: 'SPECIES',
        taxonPath: [
          'Animalia',
          'Chordata',
          'Aves',
          'Coraciiformes',
          'Alcedinidae'
        ],
        category: 'bird'
      })

      expect(requests).toHaveLength(1)
      const [request] = requests
      expect(request.method).toBe('GET')
      expect(request.url.origin + request.url.pathname).toBe(
        `${ENDPOINT}/species/match`
      )
      expect(request.url.searchParams.get('name')).toBe('Alcedo atthis')
      expect(request.headers['User-Agent']).toMatch(
        /^activities\.next\/\S+ \(\+https:\/\/llun\.test\)$/
      )
      expect(request.headers['Accept-Language']).toBe('th')
      expect(request.headers).not.toHaveProperty('Authorization')
      expect(request.connectTimeoutInMilliseconds).toBe(2_000)
      expect(
        request.connectTimeoutInMilliseconds + request.readTimeoutInMilliseconds
      ).toBe(5_000)
    })

    it('passes the kingdom hint through', async () => {
      const { client, requests } = setup()
      await client.matchTaxon('Alcedo atthis', { kingdom: 'Animalia' })
      expect(requests[0].url.searchParams.get('kingdom')).toBe('Animalia')
    })

    it('resolves a synonym to the accepted taxon', async () => {
      const { client } = setup()

      await expect(client.matchTaxon('Parus caeruleus')).resolves.toMatchObject(
        { taxonKey: '2487879', scientificName: 'Cyanistes caeruleus' }
      )
    })

    it('answers null for no match and for a genus unless allowed', async () => {
      const { client } = setup()

      await expect(client.matchTaxon('Zzzqx blorp')).resolves.toBeNull()
      await expect(client.matchTaxon('Alcedo')).resolves.toBeNull()
      await expect(
        client.matchTaxon('Alcedo', { allowHigherRank: true })
      ).resolves.toMatchObject({ taxonKey: '2475493', rank: 'GENUS' })
    })

    it('answers null for a blank name without a request', async () => {
      const { client, requests } = setup()
      await expect(client.matchTaxon('   ')).resolves.toBeNull()
      expect(requests).toHaveLength(0)
    })

    it('serves a repeat from the cache, case and spacing aside', async () => {
      const { client, requests, rows } = setup()

      await client.matchTaxon('Alcedo atthis')
      await client.matchTaxon('  alcedo   ATTHIS ')

      expect(requests).toHaveLength(1)
      expect([...rows.keys()]).toEqual(['gbif-match:alcedo atthis'])
    })

    it('caches a no-match so a typo is not asked again', async () => {
      const { client, requests } = setup()

      await client.matchTaxon('Zzzqx blorp')
      await client.matchTaxon('Zzzqx blorp')

      expect(requests).toHaveLength(1)
    })
  })

  describe('getTaxon', () => {
    it('reads the taxon and its IUCN category', async () => {
      const { client, requests } = setup()

      await expect(client.getTaxon('5219416')).resolves.toMatchObject({
        taxonKey: '5219416',
        scientificName: 'Panthera tigris',
        category: 'mammal',
        iucnCategory: 'EN'
      })
      expect(requests.map((request) => request.url.pathname)).toEqual([
        '/v1/species/5219416',
        '/v1/species/5219416/iucnRedListCategory'
      ])
    })

    it('includes the vernacular name', async () => {
      const { client } = setup()
      await expect(client.getTaxon('2475532')).resolves.toMatchObject({
        vernacularName: 'Common Kingfisher',
        iucnCategory: 'LC'
      })
    })

    it('has a null category when GBIF has no assessment (204)', async () => {
      const { client } = setup((url) =>
        url.pathname.endsWith('/iucnRedListCategory')
          ? { statusCode: 204 }
          : gbifApi(url)
      )

      await expect(client.getTaxon('2475532')).resolves.toMatchObject({
        iucnCategory: null
      })
    })

    it('falls back to the species assessment for a subspecies', async () => {
      const { client, requests } = setup((url) => {
        if (url.pathname === '/v1/species/777') {
          return {
            body: {
              ...taxonKingfisher,
              key: 777,
              nubKey: 777,
              speciesKey: 5219416,
              rank: 'SUBSPECIES',
              canonicalName: 'Panthera tigris altaica'
            }
          }
        }
        if (url.pathname === '/v1/species/777/iucnRedListCategory') {
          return { statusCode: 204 }
        }
        return gbifApi(url)
      })

      await expect(client.getTaxon('777')).resolves.toMatchObject({
        taxonKey: '777',
        rank: 'SUBSPECIES',
        iucnCategory: 'EN'
      })
      expect(requests.map((request) => request.url.pathname)).toContain(
        '/v1/species/5219416/iucnRedListCategory'
      )
    })

    it('follows a synonym key to the accepted taxon once', async () => {
      const { client } = setup((url) =>
        url.pathname === '/v1/species/8191482'
          ? {
              body: {
                ...taxonKingfisher,
                key: 8191482,
                nubKey: 8191482,
                acceptedKey: 2487879,
                taxonomicStatus: 'SYNONYM'
              }
            }
          : gbifApi(url)
      )

      await expect(client.getTaxon('8191482')).resolves.toMatchObject({
        taxonKey: '2487879'
      })
    })

    it('answers null for an unknown key and refuses a non-numeric one', async () => {
      const { client, requests } = setup()

      await expect(client.getTaxon('99999999')).resolves.toBeNull()
      requests.length = 0
      await expect(client.getTaxon('../etc')).resolves.toBeNull()
      expect(requests).toHaveLength(0)
    })
  })

  describe('getIucnCategory', () => {
    it('reads the code, or null with no assessment', async () => {
      const { client } = setup()
      await expect(client.getIucnCategory('5219416')).resolves.toBe('EN')
      await expect(client.getIucnCategory('99999999')).resolves.toBeNull()
    })
  })

  describe('searchTaxa', () => {
    it('searches the backbone for accepted species and shapes the results', async () => {
      const { client, requests } = setup()

      const results = await client.searchTaxa('kingfisher')

      const url = requests[0].url
      expect(url.pathname).toBe('/v1/species/search')
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        q: 'kingfisher',
        rank: 'SPECIES',
        status: 'ACCEPTED',
        limit: '10'
      })
      expect(results.map((result) => result.scientificName)).toEqual([
        'Alcedo atthis',
        'Halcyon smyrnensis',
        'Scolopendra alcyona'
      ])
      expect(results[0]).toMatchObject({
        taxonKey: '2475532',
        category: 'bird',
        vernacularName: 'Common Kingfisher'
      })
      expect(results[0].vernacularNames).toContain('European Kingfisher')
      expect(results[2].category).toBe('other')
    })

    it('answers an empty list for a short query without a request', async () => {
      const { client, requests } = setup()
      await expect(client.searchTaxa(' a ')).resolves.toEqual([])
      expect(requests).toHaveLength(0)
    })

    it('caches a search', async () => {
      const { client, requests } = setup()
      await client.searchTaxa('Kingfisher')
      await client.searchTaxa('kingfisher')
      expect(requests).toHaveLength(1)
    })

    it('drops results it cannot read and caps at ten', async () => {
      const many = Array.from({ length: 15 }, (_, index) => ({
        key: 100 + index,
        canonicalName: `Species ${index}`,
        rank: 'SPECIES',
        class: 'Aves'
      }))
      const { client } = setup(() => ({
        body: { results: [{ junk: true }, ...many] }
      }))

      const results = await client.searchTaxa('species')
      expect(results).toHaveLength(10)
      expect(results[0].scientificName).toBe('Species 0')
    })
  })

  describe('failures', () => {
    it('opens the circuit on a 429 for Retry-After and then fails fast', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
      try {
        const { client, requests } = setup(() => ({
          statusCode: 429,
          headers: { 'retry-after': '120' }
        }))

        await expect(client.matchTaxon('Alcedo atthis')).rejects.toMatchObject({
          code: 'unavailable'
        })
        expect(requests).toHaveLength(1)

        // A different key: not cached, but the circuit is open.
        await expect(client.matchTaxon('Corvus corax')).rejects.toMatchObject({
          code: 'circuit-open'
        })
        expect(requests).toHaveLength(1)

        vi.advanceTimersByTime(121_000)
        await expect(client.matchTaxon('Corvus cornix')).rejects.toMatchObject({
          code: 'unavailable'
        })
        expect(requests).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('opens the circuit on a 5xx', async () => {
      const { client, provider } = setup(() => ({ statusCode: 503 }))
      await expect(client.getTaxon('1')).rejects.toBeInstanceOf(LookupError)
      expect(provider.breaker.isOpen()).toBe(true)
    })

    it('opens the circuit on a timeout or network failure', async () => {
      const { client, provider } = setup(() =>
        Object.assign(new Error('Timeout awaiting request'), {
          code: 'ETIMEDOUT'
        })
      )

      await expect(client.getTaxon('1')).rejects.toMatchObject({
        code: 'network'
      })
      expect(provider.breaker.isOpen()).toBe(true)
    })

    it('does not open the circuit for a 400', async () => {
      const { client, provider } = setup(() => ({ statusCode: 400 }))
      await expect(client.getTaxon('1')).rejects.toMatchObject({ code: 'http' })
      expect(provider.breaker.isOpen()).toBe(false)
    })

    it('does not open the circuit for an oversized body', async () => {
      const { client, provider } = setup(() => ({
        body: 'x'.repeat(300 * 1024)
      }))
      await expect(client.getTaxon('1')).rejects.toMatchObject({
        code: 'network'
      })
      expect(provider.breaker.isOpen()).toBe(false)
    })

    it('treats invalid JSON as a parse failure', async () => {
      const { client } = setup(() => ({ body: '<html>' }))
      await expect(client.getTaxon('1')).rejects.toMatchObject({
        code: 'parse'
      })
    })

    it('remembers a failure for a while, so a repeat is not requested', async () => {
      const { client, requests } = setup(() => ({ statusCode: 400 }))

      await expect(client.getTaxon('1')).rejects.toBeInstanceOf(LookupError)
      await expect(client.getTaxon('1')).rejects.toMatchObject({
        code: 'unavailable'
      })
      expect(requests).toHaveLength(1)
    })

    it('reports rate limiting as a lookup error', async () => {
      const stub = createStubFetch(() => ({ body: {} }))
      const db = createFakeLookupDatabase()
      const provider = createTestProvider({
        limiter: createLimiter({
          maxConcurrent: 1,
          minIntervalMs: 1000,
          maxWaitMs: 0,
          maxQueue: 0
        }),
        breaker: createCircuitBreaker()
      })
      const client = createGbifClient({
        database: db.database,
        fetch: stub.fetch,
        provider,
        endpoint: ENDPOINT
      })

      await client.getTaxon('1').catch(() => undefined)
      await expect(client.getTaxon('2')).rejects.toMatchObject({
        code: 'rate-limited'
      })
    })

    it('refuses an endpoint that resolves to a private address', async () => {
      const db = createFakeLookupDatabase()
      const { createSafeRemoteFetch } =
        await import('@/lib/utils/safeRemoteFetch')
      const client = createGbifClient({
        database: db.database,
        fetch: createSafeRemoteFetch({
          resolveHost: async () => [{ address: '10.0.0.5', family: 4 }]
        }),
        provider: createTestProvider(),
        endpoint: ENDPOINT
      })

      await expect(client.getTaxon('1')).rejects.toMatchObject({
        code: 'network'
      })
    })
  })
})
