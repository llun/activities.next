import { Database } from '@/lib/database/types'
import { RESOLVE_MEDIA_SUBJECT_JOB_NAME } from '@/lib/jobs/names'
import { resolveMediaSubjectJob } from '@/lib/jobs/resolveMediaSubjectJob'
import iucnCritical from '@/lib/services/gallery/lookups/__fixtures__/gbif-iucn-cr.json'
import iucnEndangered from '@/lib/services/gallery/lookups/__fixtures__/gbif-iucn-en.json'
import iucnLeastConcern from '@/lib/services/gallery/lookups/__fixtures__/gbif-iucn-lc.json'
import matchGenusOnly from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-higherrank-genus.json'
import matchPongoHigherRank from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-higherrank-pongo.json'
import matchNone from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-none.json'
import matchTiger from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-tiger.json'
import searchKingfisher from '@/lib/services/gallery/lookups/__fixtures__/gbif-search-kingfisher.json'
import taxonKingfisher from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-kingfisher.json'
import taxonNotFound from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-not-found.json'
import taxonPongoAbelii from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-pongo-abelii.json'
import taxonTiger from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-tiger.json'
import { createFakeLookupDatabase } from '@/lib/services/gallery/lookups/lookupTestUtils'
import { isPlaceWithheldForThreat } from '@/lib/services/gallery/threatenedSpecies'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'

// The real GBIF client, end to end through the job, with only the network
// stubbed: an answer the client cannot read must end as `failed` (place
// withheld), never as `resolved`/`NE` or `no-match` (place shown).

// What a wrong or retired endpoint answers (live: api.gbif.org without /v1).
const HTML_404 = {
  statusCode: 404,
  body: '<!DOCTYPE html><html><head><title>404 Not Found</title></head></html>'
}

type Answer = { statusCode: number; body: unknown }
// An answer per path, or one that depends on the request (the kingdom hint).
const answers = new Map<string, Answer | ((url: URL) => Answer)>()
const mockFetch = vi.fn(async ({ url }: { url: string }) => {
  const parsed = new URL(url)
  const entry = answers.get(parsed.pathname) ?? HTML_404
  const answer = typeof entry === 'function' ? entry(parsed) : entry
  return {
    body:
      typeof answer.body === 'string'
        ? answer.body
        : JSON.stringify(answer.body),
    bodyTruncated: false,
    headers: {},
    statusCode: answer.statusCode,
    url
  }
})
vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: (params: { url: string }) => mockFetch(params)
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test',
    languages: ['en'],
    gallery: { gbif: { endpoint: 'https://gbif.test/v1' } }
  })
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: async () => ({
    network: { speciesLookups: true }
  })
}))

const TIGER: Partial<MediaDetailsRecord> = {
  subjectName: 'Tiger',
  subjectScientificName: 'Panthera tigris',
  subjectCategory: 'mammal',
  subjectTaxonKey: null,
  subjectLookupStatus: 'pending'
}

const run = async (details: Partial<MediaDetailsRecord> = TIGER) => {
  const lookups = createFakeLookupDatabase()
  const setMediaSubjectLookup = vi.fn().mockResolvedValue(true)
  const database = {
    ...lookups.spies,
    getMediaWithAttachedStatusIds: vi.fn().mockResolvedValue({
      media: { id: '7', details },
      statusIds: []
    }),
    setMediaSubjectLookup
  } as unknown as Database

  await resolveMediaSubjectJob(database, {
    id: 'job-1',
    name: RESOLVE_MEDIA_SUBJECT_JOB_NAME,
    data: { mediaId: '7' }
  })

  expect(setMediaSubjectLookup).toHaveBeenCalledTimes(1)
  const { patch } = setMediaSubjectLookup.mock.calls[0][0]
  const stored = {
    ...details,
    subjectIucnCategory: null,
    ...patch
  } as MediaDetailsRecord
  return {
    patch,
    withheld: isPlaceWithheldForThreat(stored, { hideThreatenedPlaces: true })
  }
}

describe('resolveMediaSubjectJob fails closed on unreadable GBIF answers', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    answers.clear()
    answers.set('/v1/species/match', { statusCode: 200, body: matchTiger })
    answers.set('/v1/species/5219416', { statusCode: 200, body: taxonTiger })
    answers.set('/v1/species/5219416/iucnRedListCategory', {
      statusCode: 200,
      body: iucnEndangered
    })
  })

  it('records a readable EN answer as threatened', async () => {
    const { patch, withheld } = await run()
    expect(patch).toMatchObject({
      subjectIucnCategory: 'EN',
      subjectLookupStatus: 'resolved'
    })
    expect(withheld).toBe(true)
  })

  it.each([
    ['moved its code', { usageKey: 5219416, iucn: { code: 'EN' } }],
    ['an unknown code', { code: 'ZZ' }],
    ['an empty object', {}]
  ])('records failed for an IUCN answer with %s', async (_, body) => {
    answers.set('/v1/species/5219416/iucnRedListCategory', {
      statusCode: 200,
      body
    })

    const { patch, withheld } = await run()

    expect(patch).toEqual({ subjectLookupStatus: 'failed' })
    expect(withheld).toBe(true)
  })

  it('records failed for a species record in a changed shape', async () => {
    answers.set('/v1/species/5219416', {
      statusCode: 200,
      body: { usage: { key: 5219416, name: 'Panthera tigris' } }
    })

    const { patch, withheld } = await run()

    expect(patch).toEqual({ subjectLookupStatus: 'failed' })
    expect(withheld).toBe(true)
  })

  it('records failed for a match answer in a changed shape', async () => {
    answers.set('/v1/species/match', {
      statusCode: 200,
      body: { usage: { key: 5219416 }, diagnostics: { matchType: 'EXACT' } }
    })

    const { patch, withheld } = await run()

    expect(patch).toEqual({ subjectLookupStatus: 'failed' })
    expect(withheld).toBe(true)
  })

  it('still records NE, resolved, for a 204 (no assessment)', async () => {
    answers.set('/v1/species/5219416/iucnRedListCategory', {
      statusCode: 204,
      body: ''
    })

    const { patch } = await run()

    expect(patch).toMatchObject({
      subjectIucnCategory: 'NE',
      subjectLookupStatus: 'resolved'
    })
  })

  describe('a 404 is not "nothing found"', () => {
    it('records failed for a 404 from species/match', async () => {
      answers.set('/v1/species/match', HTML_404)

      const { patch, withheld } = await run()

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    })

    it('records failed for a 404 from species/search', async () => {
      answers.set('/v1/species/search', HTML_404)

      const { patch, withheld } = await run({
        subjectName: 'Common Kingfisher',
        subjectScientificName: null,
        subjectCategory: 'bird',
        subjectTaxonKey: null,
        subjectLookupStatus: 'pending'
      })

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    })

    it('still resolves a common name when search answers 200', async () => {
      answers.set('/v1/species/search', {
        statusCode: 200,
        body: searchKingfisher
      })
      answers.set('/v1/species/2475532', {
        statusCode: 200,
        body: taxonKingfisher
      })
      answers.set('/v1/species/2475532/iucnRedListCategory', {
        statusCode: 200,
        body: iucnLeastConcern
      })

      const { patch } = await run({
        subjectName: 'Common Kingfisher',
        subjectScientificName: null,
        subjectCategory: 'bird',
        subjectTaxonKey: null,
        subjectLookupStatus: 'pending'
      })

      expect(patch).toMatchObject({ subjectLookupStatus: 'resolved' })
    })

    it('records failed for a 404 from iucnRedListCategory', async () => {
      answers.set('/v1/species/5219416/iucnRedListCategory', {
        statusCode: 404,
        body: ''
      })

      const { patch, withheld } = await run()

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    })

    it('records failed for an HTML 404 for a stored taxon key', async () => {
      answers.set('/v1/species/5219416', HTML_404)

      const { patch, withheld } = await run({
        ...TIGER,
        subjectScientificName: null,
        subjectTaxonKey: '5219416'
      })

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    })

    it('records failed when GBIF does not know the key its match named', async () => {
      answers.set('/v1/species/5219416', {
        statusCode: 404,
        body: taxonNotFound
      })

      const { patch, withheld } = await run()

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    })

    it('records failed when GBIF does not know the key its search named', async () => {
      answers.set('/v1/species/search', {
        statusCode: 200,
        body: searchKingfisher
      })
      answers.set('/v1/species/2475532', {
        statusCode: 404,
        body: taxonNotFound
      })

      const { patch, withheld } = await run({
        subjectName: 'Common Kingfisher',
        subjectScientificName: null,
        subjectCategory: 'bird',
        subjectTaxonKey: null,
        subjectLookupStatus: 'pending'
      })

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    })

    it('records failed for a retired stored key with no name to try', async () => {
      answers.set('/v1/species/111', { statusCode: 404, body: taxonNotFound })

      const { patch, withheld } = await run({
        subjectName: null,
        subjectScientificName: null,
        subjectCategory: null,
        subjectTaxonKey: '111',
        subjectLookupStatus: 'pending'
      })

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    })

    it('tries the names when GBIF no longer knows a stored key', async () => {
      answers.set('/v1/species/111', { statusCode: 404, body: taxonNotFound })

      const { patch, withheld } = await run({
        ...TIGER,
        subjectTaxonKey: '111'
      })

      expect(patch).toMatchObject({
        subjectTaxonKey: '5219416',
        subjectIucnCategory: 'EN',
        subjectLookupStatus: 'resolved'
      })
      expect(withheld).toBe(true)
    })
  })

  describe('a wrong kingdom hint is not a no-match', () => {
    // Live: species/match?name=Panthera tigris&kingdom=Plantae&strict=false
    const KINGDOM_ANSWER = {
      usageKey: 6,
      scientificName: 'Plantae',
      canonicalName: 'Plantae',
      rank: 'KINGDOM',
      status: 'ACCEPTED',
      confidence: 100,
      matchType: 'HIGHERRANK',
      kingdom: 'Plantae',
      kingdomKey: 6,
      synonym: false
    }
    const TIGER_AS_PLANT = { ...TIGER, subjectCategory: 'plant' as const }

    it('asks again without the hint and finds the tiger', async () => {
      answers.set('/v1/species/match', (url) =>
        url.searchParams.get('kingdom') === 'Plantae'
          ? { statusCode: 200, body: KINGDOM_ANSWER }
          : { statusCode: 200, body: matchTiger }
      )

      const { patch, withheld } = await run(TIGER_AS_PLANT)

      expect(patch).toMatchObject({
        subjectTaxonKey: '5219416',
        subjectIucnCategory: 'EN',
        subjectLookupStatus: 'resolved'
      })
      expect(withheld).toBe(true)
    })

    it('asks again when the hinted answer is NONE', async () => {
      answers.set('/v1/species/match', (url) =>
        url.searchParams.get('kingdom')
          ? { statusCode: 200, body: matchNone }
          : { statusCode: 200, body: matchTiger }
      )

      const { patch, withheld } = await run(TIGER_AS_PLANT)

      expect(patch).toMatchObject({ subjectIucnCategory: 'EN' })
      expect(withheld).toBe(true)
    })

    it('records failed when even the unhinted answer is a kingdom', async () => {
      answers.set('/v1/species/match', {
        statusCode: 200,
        body: KINGDOM_ANSWER
      })

      const { patch, withheld } = await run(TIGER_AS_PLANT)

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    })

    it('records failed when the retry without the hint fails', async () => {
      answers.set('/v1/species/match', (url) =>
        url.searchParams.get('kingdom')
          ? { statusCode: 200, body: KINGDOM_ANSWER }
          : HTML_404
      )

      const { patch, withheld } = await run(TIGER_AS_PLANT)

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    })

    it('records no-match only when the unhinted answer is NONE too', async () => {
      answers.set('/v1/species/match', { statusCode: 200, body: matchNone })

      const { patch, withheld } = await run({
        ...TIGER_AS_PLANT,
        subjectScientificName: 'Zzzqx blorp'
      })

      expect(patch).toMatchObject({ subjectLookupStatus: 'no-match' })
      expect(withheld).toBe(false)
    })
  })

  describe('a HIGHERRANK answer is not a no-match', () => {
    const MISTYPED_ORANGUTAN: Partial<MediaDetailsRecord> = {
      subjectName: 'Sumatran orangutan',
      subjectScientificName: 'Pongo abelii xyz',
      subjectCategory: 'mammal',
      subjectTaxonKey: null,
      subjectLookupStatus: 'pending'
    }

    beforeEach(() => {
      answers.set('/v1/species/match', {
        statusCode: 200,
        body: matchPongoHigherRank
      })
      answers.set('/v1/species/5707420', {
        statusCode: 200,
        body: taxonPongoAbelii
      })
      answers.set('/v1/species/5707420/iucnRedListCategory', {
        statusCode: 200,
        body: iucnCritical
      })
    })

    it('keeps the place of a CR species GBIF placed the name in hidden', async () => {
      const { patch, withheld } = await run(MISTYPED_ORANGUTAN)

      // Resolved with the category, but the owner's name is not confirmed:
      // no taxon key is written.
      expect(patch).toEqual({
        subjectIucnCategory: 'CR',
        subjectTaxonPath: null,
        subjectLookupStatus: 'resolved'
      })
      expect(withheld).toBe(true)
    })

    it('clears the place when that species is not threatened', async () => {
      answers.set('/v1/species/5707420/iucnRedListCategory', {
        statusCode: 200,
        body: iucnLeastConcern
      })

      const { patch, withheld } = await run(MISTYPED_ORANGUTAN)

      expect(patch).toMatchObject({ subjectLookupStatus: 'no-match' })
      expect(withheld).toBe(false)
    })

    it('records failed when the IUCN check of that species fails', async () => {
      answers.set('/v1/species/5707420/iucnRedListCategory', HTML_404)

      const { patch, withheld } = await run(MISTYPED_ORANGUTAN)

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    })

    it('records failed for a name placed only in a genus', async () => {
      answers.set('/v1/species/match', {
        statusCode: 200,
        body: matchGenusOnly
      })

      const { patch, withheld } = await run({
        ...MISTYPED_ORANGUTAN,
        subjectScientificName: 'Pongo xyzzy'
      })

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    })

    it('treats a species match below the confidence bar the same way', async () => {
      answers.set('/v1/species/match', {
        statusCode: 200,
        body: { ...matchPongoHigherRank, matchType: 'FUZZY', confidence: 80 }
      })

      const { patch, withheld } = await run(MISTYPED_ORANGUTAN)

      expect(patch).toMatchObject({
        subjectIucnCategory: 'CR',
        subjectLookupStatus: 'resolved'
      })
      expect(withheld).toBe(true)
    })
  })
})
