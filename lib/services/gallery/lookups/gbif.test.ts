import { getConfig } from '@/lib/config'
import { DEFAULT_GBIF_ENDPOINT } from '@/lib/config/gallery'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import iucnEndangered from './__fixtures__/gbif-iucn-en.json'
import iucnLeastConcern from './__fixtures__/gbif-iucn-lc.json'
import matchExact from './__fixtures__/gbif-match-exact.json'
import matchGenus from './__fixtures__/gbif-match-genus.json'
import matchGenusOnly from './__fixtures__/gbif-match-higherrank-genus.json'
import matchPongoHigherRank from './__fixtures__/gbif-match-higherrank-pongo.json'
import matchNone from './__fixtures__/gbif-match-none.json'
import matchSynonym from './__fixtures__/gbif-match-synonym.json'
import matchTiger from './__fixtures__/gbif-match-tiger.json'
import searchKingfisher from './__fixtures__/gbif-search-kingfisher.json'
import searchPangolin from './__fixtures__/gbif-search-pangolin.json'
import searchThaiTiger from './__fixtures__/gbif-search-thai-tiger.json'
import searchTigerPage from './__fixtures__/gbif-search-tiger-page.json'
import taxonKingfisher from './__fixtures__/gbif-taxon-kingfisher.json'
import taxonNotFound from './__fixtures__/gbif-taxon-not-found.json'
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
// Cache keys for an endpoint other than the default carry its tag.
const TAG = `@${getHashFromString(ENDPOINT).slice(0, 12)}|`
const HTML_404: StubResponse = {
  statusCode: 404,
  body: '<!DOCTYPE html><html><body>404 Not Found</body></html>'
}

// The GBIF API as recorded fixtures, keyed by the path after the endpoint.
const gbifApi = (url: URL): StubResponse => {
  const path = url.pathname.replace('/v1/', '')
  if (path === 'species/match') {
    const name = url.searchParams.get('name')
    if (name === 'Alcedo atthis') return { body: matchExact }
    if (name === 'Parus caeruleus') return { body: matchSynonym }
    if (name === 'Alcedo') return { body: matchGenus }
    if (name === 'Panthera tigris') return { body: matchTiger }
    if (name === 'Pongo abelii xyz') return { body: matchPongoHigherRank }
    if (name === 'Pongo xyzzy') return { body: matchGenusOnly }
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
  // What GBIF answers for a key it does not know, and for no assessment.
  if (/^species\/\d+$/.test(path)) {
    return { statusCode: 404, body: taxonNotFound }
  }
  if (/^species\/\d+\/iucnRedListCategory$/.test(path)) {
    return { statusCode: 204 }
  }
  return HTML_404
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
      expect([...rows.keys()]).toEqual([`gbif-match:${TAG}m2|alcedo atthis`])
    })

    it('caches a no-match so a typo is not asked again', async () => {
      const { client, requests } = setup()

      await client.matchTaxon('Zzzqx blorp')
      await client.matchTaxon('Zzzqx blorp')

      expect(requests).toHaveLength(1)
    })
  })

  describe('lookupMatch', () => {
    it('keeps a confident match', async () => {
      const { client } = setup()
      await expect(client.lookupMatch('Alcedo atthis')).resolves.toMatchObject({
        kind: 'match',
        taxon: { taxonKey: '2475532' }
      })
    })

    it('reports a HIGHERRANK answer as uncertain, with its species', async () => {
      const { client, rows } = setup()

      // "Pongo abelii xyz": GBIF places it in Pongo abelii (CR).
      await expect(client.lookupMatch('Pongo abelii xyz')).resolves.toEqual({
        kind: 'uncertain',
        uncertain: { speciesKey: '5707420', genusKey: '5219531' }
      })
      // matchTaxon still answers only confident matches.
      await expect(client.matchTaxon('Pongo abelii xyz')).resolves.toBeNull()
      // Cached as an answer, not as a miss.
      expect(rows.get(`gbif-match:${TAG}m2|pongo abelii xyz`)?.outcome).toBe(
        'ok'
      )
    })

    it('reports a name placed only in a genus as uncertain', async () => {
      const { client } = setup()
      await expect(client.lookupMatch('Pongo xyzzy')).resolves.toEqual({
        kind: 'uncertain',
        uncertain: { speciesKey: null, genusKey: '5219531' }
      })
    })

    it('reports GBIF’s NONE as none, cached as an answer', async () => {
      const { client, rows } = setup()
      await expect(client.lookupMatch('Zzzqx blorp')).resolves.toEqual({
        kind: 'none'
      })
      expect(rows.get(`gbif-match:${TAG}m2|zzzqx blorp`)?.outcome).toBe('ok')
    })

    it('answers null for a blank name without a request', async () => {
      const { client, requests } = setup()
      await expect(client.lookupMatch('  ')).resolves.toBeNull()
      expect(requests).toHaveLength(0)
    })

    it.each([
      [
        'a kingdom (a wrong kingdom hint)',
        {
          usageKey: 6,
          scientificName: 'Plantae',
          canonicalName: 'Plantae',
          rank: 'KINGDOM',
          confidence: 100,
          matchType: 'HIGHERRANK',
          kingdomKey: 6
        }
      ],
      [
        'a family',
        {
          usageKey: 5483,
          canonicalName: 'Hominidae',
          rank: 'FAMILY',
          confidence: 94,
          matchType: 'HIGHERRANK',
          familyKey: 5483
        }
      ],
      [
        'a confident kingdom',
        {
          usageKey: 1,
          canonicalName: 'Animalia',
          rank: 'KINGDOM',
          confidence: 100,
          matchType: 'EXACT'
        }
      ],
      ['an unknown match type', { matchType: 'SOMETHING_NEW' }],
      ['a NONE that carries a key', { matchType: 'NONE', usageKey: 5219416 }]
    ])('reports %s as unplaced, not none', async (_, body) => {
      const { client } = setup((url) =>
        url.pathname.endsWith('/match') ? { body } : gbifApi(url)
      )
      await expect(client.lookupMatch('Panthera tigris')).resolves.toEqual({
        kind: 'unplaced'
      })
    })

    it.each([
      ['a legacy miss', { outcome: 'miss', value: null }],
      ['an unknown value', { outcome: 'ok', value: { surprise: true } }],
      [
        'an uncertain value with a bad key',
        { outcome: 'ok', value: { uncertain: { speciesKey: 'x' } } }
      ]
    ])('throws for a cached row holding %s', async (_, row) => {
      const { client, rows } = setup()
      rows.set(`gbif-match:${TAG}m2|panthera tigris`, {
        kind: 'gbif-match',
        key: `${TAG}m2|panthera tigris`,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        ...(row as { outcome: 'ok' | 'miss'; value: unknown })
      })
      await expect(client.lookupMatch('Panthera tigris')).rejects.toMatchObject(
        { code: 'parse' }
      )
    })
  })

  // A 404 is "nothing here" only where GBIF itself says so; anywhere else it
  // is a wrong or retired endpoint, and "nothing found" would clear a
  // threatened species' place.
  describe('non-200 answers', () => {
    it.each([
      [
        'species/match',
        () =>
          setup((url) =>
            url.pathname.endsWith('/match') ? HTML_404 : gbifApi(url)
          ).client.matchTaxon('Panthera tigris')
      ],
      [
        'species/search',
        () =>
          setup((url) =>
            url.pathname.endsWith('/search') ? HTML_404 : gbifApi(url)
          ).client.searchTaxa('kingfisher')
      ],
      [
        'iucnRedListCategory',
        () =>
          setup((url) =>
            url.pathname.endsWith('/iucnRedListCategory')
              ? { statusCode: 404, body: taxonNotFound }
              : gbifApi(url)
          ).client.getTaxon('5219416')
      ],
      [
        'species/{key} with an HTML page',
        () =>
          setup((url) =>
            url.pathname === '/v1/species/5219416' ? HTML_404 : gbifApi(url)
          ).client.getTaxon('5219416')
      ]
    ])('throws an http error for a 404 from %s', async (_, call) => {
      await expect(call()).rejects.toMatchObject({ code: 'http' })
    })

    it('throws an http error for a 204 from species/match', async () => {
      const { client } = setup((url) =>
        url.pathname.endsWith('/match') ? { statusCode: 204 } : gbifApi(url)
      )
      await expect(client.matchTaxon('Panthera tigris')).rejects.toMatchObject({
        code: 'http'
      })
    })

    it('does not cache a 404 from species/match as a miss', async () => {
      const { client, rows } = setup((url) =>
        url.pathname.endsWith('/match') ? HTML_404 : gbifApi(url)
      )
      await expect(client.matchTaxon('Panthera tigris')).rejects.toThrow()
      expect(rows.get(`gbif-match:${TAG}m2|panthera tigris`)?.outcome).toBe(
        'error'
      )
    })

    it('throws for a JSON 404 from species/{key} that is not GBIF’s', async () => {
      const { client } = setup((url) =>
        url.pathname === '/v1/species/5219416'
          ? { statusCode: 404, body: { error: 'no route' } }
          : gbifApi(url)
      )
      await expect(client.getTaxon('5219416')).rejects.toMatchObject({
        code: 'http'
      })
    })

    it('reads GBIF’s own 404 for an unknown key as no taxon', async () => {
      const { client } = setup()
      await expect(client.getTaxon('111')).resolves.toBeNull()
    })
  })

  describe('cache keys', () => {
    it('keeps unprefixed keys for the default endpoint', async () => {
      const stub = createStubFetch((request) => gbifApi(request.url))
      const db = createFakeLookupDatabase()
      const client = createGbifClient({
        database: db.database,
        fetch: stub.fetch,
        provider: createTestProvider({ name: 'GBIF' }),
        endpoint: DEFAULT_GBIF_ENDPOINT
      })

      await client.matchTaxon('Alcedo atthis')

      expect([...db.rows.keys()]).toEqual(['gbif-match:m2|alcedo atthis'])
    })

    it('does not serve one endpoint’s answers for another', async () => {
      const db = createFakeLookupDatabase()
      const stub = createStubFetch((request) => gbifApi(request.url))
      const clientFor = (endpoint: string) =>
        createGbifClient({
          database: db.database,
          fetch: stub.fetch,
          provider: createTestProvider({ name: 'GBIF' }),
          endpoint
        })

      await clientFor(ENDPOINT).matchTaxon('Alcedo atthis')
      await clientFor('https://gbif.other.test/v1').matchTaxon('Alcedo atthis')

      expect(stub.requests).toHaveLength(2)
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

    it('asks again about an unknown key on a retry', async () => {
      const db = createFakeLookupDatabase()
      const stub = createStubFetch((request) => gbifApi(request.url))
      const clientWith = (skipCachedErrors: boolean) =>
        createGbifClient({
          database: db.database,
          fetch: stub.fetch,
          provider: createTestProvider({ name: 'GBIF' }),
          endpoint: ENDPOINT,
          skipCachedErrors
        })

      await clientWith(false).getTaxon('99999999')
      await clientWith(false).getTaxon('99999999')
      expect(stub.requests).toHaveLength(1)

      await clientWith(true).getTaxon('99999999')
      expect(stub.requests).toHaveLength(2)
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
      // The skipped one may have been the name asked for.
      await expect(client.lookupSearch('species')).resolves.toMatchObject({
        complete: false
      })
    })

    it('reports a fully readable answer as complete, an empty one too', async () => {
      const { client } = setup(() => ({
        body: { results: [], endOfRecords: true }
      }))
      await expect(client.lookupSearch('nothing here')).resolves.toEqual({
        results: [],
        complete: true,
        exhaustive: true,
        exactTaxonKeys: []
      })
    })

    it('names the results that name the query exactly', async () => {
      const { client } = setup()
      await expect(
        client.lookupSearch('  common   KINGFISHER ')
      ).resolves.toMatchObject({
        complete: true,
        exhaustive: true,
        exactTaxonKeys: ['2475532']
      })
      // "Kingfisher" is a vernacular name of Alcedo atthis only.
      await expect(client.lookupSearch('Kingfisher')).resolves.toMatchObject({
        exactTaxonKeys: ['2475532']
      })
      await expect(
        client.lookupSearch('Halcyon smyrnensis')
      ).resolves.toMatchObject({ exactTaxonKeys: ['5228328'] })
    })

    // Live: q=tiger has 1556 results, and Panthera tigris is not on page 1.
    it.each([
      ['endOfRecords is false', { ...searchTigerPage }],
      [
        'endOfRecords is missing',
        { ...searchTigerPage, endOfRecords: undefined }
      ],
      ['endOfRecords is not a boolean', { ...searchTigerPage, endOfRecords: 1 }]
    ])('is not exhaustive when %s', async (_, body) => {
      const { client } = setup(() => ({ body }))
      await expect(client.lookupSearch('Tiger')).resolves.toMatchObject({
        complete: true,
        exhaustive: false,
        exactTaxonKeys: []
      })
    })

    // Live: q=เสือโคร่ง answers only Panthera tigris, with 202 names; the
    // Thai one sorts 42nd, past the 20 kept for display.
    it('matches every vernacular name, not just the ones it keeps', async () => {
      const { client } = setup(() => ({ body: searchThaiTiger }))

      const outcome = await client.lookupSearch('เสือโคร่ง')

      expect(outcome).toMatchObject({
        complete: true,
        exhaustive: true,
        exactTaxonKeys: ['5219416']
      })
      expect(outcome?.results[0].vernacularNames).toHaveLength(20)
      expect(outcome?.results[0].vernacularNames).not.toContain('เสือโคร่ง')
    })

    it('matches a name in another Unicode normal form', async () => {
      const { client } = setup(() => ({ body: searchThaiTiger }))
      // A name with accents ("Lǎohǔ"), typed decomposed.
      const name = searchThaiTiger.results[0].vernacularNames
        .map(({ vernacularName }) => vernacularName)
        .find((vernacular) => vernacular.normalize('NFD') !== vernacular)
      expect(name).toBeDefined()
      await expect(
        client.lookupSearch((name as string).normalize('NFD'))
      ).resolves.toMatchObject({ exactTaxonKeys: ['5219416'] })
    })

    // Live: seven Manis species are each called "Pangolin".
    it('names every result that shares the name', async () => {
      const { client } = setup(() => ({ body: searchPangolin }))
      const outcome = await client.lookupSearch('Pangolin')
      expect(outcome?.exactTaxonKeys).toHaveLength(7)
      expect(outcome?.exhaustive).toBe(false)
    })

    it('names nothing exactly for a query cut to 100 characters', async () => {
      const name = `Common Kingfisher${' x'.repeat(60)}`
      const { client, requests } = setup(() => ({
        body: {
          endOfRecords: true,
          results: [
            {
              ...searchKingfisher.results[0],
              vernacularNames: [
                { vernacularName: name.slice(0, 100), language: 'eng' }
              ]
            }
          ]
        }
      }))
      await expect(client.lookupSearch(name)).resolves.toMatchObject({
        exactTaxonKeys: []
      })
      expect(requests[0].url.searchParams.get('q')).toHaveLength(100)
      await expect(
        client.lookupSearch(name.slice(0, 100))
      ).resolves.toMatchObject({ exactTaxonKeys: ['2475532'] })
    })

    it.each([
      [
        'an s3 row with no exhaustive flag',
        { results: [], complete: true, exactTaxonKeys: [] }
      ],
      [
        'an s3 row with no exact keys',
        { results: [], complete: true, exhaustive: true }
      ],
      [
        'an s3 row with a bad exact key',
        { results: [], complete: true, exhaustive: true, exactTaxonKeys: [5] }
      ]
    ])('throws for a cached row holding %s', async (_, value) => {
      const { client, rows } = setup()
      rows.set(`gbif-search:${TAG}s3|tiger`, {
        kind: 'gbif-search',
        key: `${TAG}s3|tiger`,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        outcome: 'ok',
        value
      })
      await expect(client.lookupSearch('Tiger')).rejects.toMatchObject({
        code: 'parse'
      })
    })

    it('never reads an s2 row, whose exact hits came from a cut list', async () => {
      const { client, rows, requests } = setup(() => ({
        body: searchTigerPage
      }))
      rows.set(`gbif-search:${TAG}s2|tiger`, {
        kind: 'gbif-search',
        key: `${TAG}s2|tiger`,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        outcome: 'ok',
        value: { results: [], complete: true }
      })
      await expect(client.lookupSearch('Tiger')).resolves.toMatchObject({
        exhaustive: false
      })
      expect(requests).toHaveLength(1)
    })
  })

  // Fail closed: an answer this code cannot read is a failure (so the job
  // records `failed` and the place stays hidden), never "not assessed" or
  // "no match" (which would show a threatened species' place).
  describe('unreadable answers', () => {
    const withIucn = (body: unknown) => (url: URL) =>
      url.pathname === '/v1/species/5219416/iucnRedListCategory'
        ? { body }
        : gbifApi(url)

    it.each([
      ['no code and no category', { usageKey: 5219416 }],
      ['an unknown code', { code: 'XX', category: 'SOMETHING_NEW' }],
      ['a list', []],
      ['a string', 'EN']
    ])('throws a parse error for an IUCN answer with %s', async (_, body) => {
      const { client } = setup(withIucn(body))

      await expect(client.getTaxon('5219416')).rejects.toMatchObject({
        code: 'parse'
      })
      await expect(client.getIucnCategory('5219416')).rejects.toBeInstanceOf(
        LookupError
      )
    })

    it('reads the long category name when the code moved', async () => {
      const { client } = setup(withIucn({ category: 'ENDANGERED' }))

      await expect(client.getTaxon('5219416')).resolves.toMatchObject({
        iucnCategory: 'EN'
      })
    })

    it('does not cache an unreadable taxon as a hit', async () => {
      const { client, rows } = setup(withIucn({ usageKey: 5219416 }))

      await expect(client.getTaxon('5219416')).rejects.toBeInstanceOf(
        LookupError
      )
      expect(rows.get(`gbif-taxon:${TAG}5219416`)?.outcome).toBe('error')
    })

    it('throws a parse error for a species record it cannot read', async () => {
      const { client } = setup((url) =>
        url.pathname === '/v1/species/5219416'
          ? { body: { id: 5219416, name: 'Panthera tigris' } }
          : gbifApi(url)
      )

      await expect(client.getTaxon('5219416')).rejects.toMatchObject({
        code: 'parse'
      })
    })

    it('throws a parse error for a match answer it cannot read', async () => {
      const { client } = setup((url) =>
        url.pathname === '/v1/species/match'
          ? { body: { result: { usageKey: 5219416, type: 'EXACT' } } }
          : gbifApi(url)
      )

      await expect(client.matchTaxon('Panthera tigris')).rejects.toMatchObject({
        code: 'parse'
      })
    })

    it('throws a parse error for an accepted match missing its key', async () => {
      const { client } = setup((url) =>
        url.pathname === '/v1/species/match'
          ? { body: { ...matchTiger, usageKey: undefined } }
          : gbifApi(url)
      )

      await expect(client.matchTaxon('Panthera tigris')).rejects.toMatchObject({
        code: 'parse'
      })
    })

    it.each([
      ['no results list', { hits: [] }],
      ['only unreadable results', { results: [{ junk: true }] }]
    ])('throws a parse error for a search with %s', async (_, body) => {
      const { client } = setup(() => ({ body }))

      await expect(client.searchTaxa('kingfisher')).rejects.toMatchObject({
        code: 'parse'
      })
    })

    it('still answers an empty list for a search with no results', async () => {
      const { client } = setup(() => ({ body: { results: [] } }))
      await expect(client.searchTaxa('kingfisher')).resolves.toEqual([])
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
