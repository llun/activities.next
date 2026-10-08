import { Database } from '@/lib/database/types'
import { RESOLVE_MEDIA_SUBJECT_JOB_NAME } from '@/lib/jobs/names'
import { resolveMediaSubjectJob } from '@/lib/jobs/resolveMediaSubjectJob'
import iucnLeastConcern from '@/lib/services/gallery/lookups/__fixtures__/gbif-iucn-lc.json'
import matchFuzzy from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-fuzzy.json'
import matchSynonym from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-synonym.json'
import searchPanda from '@/lib/services/gallery/lookups/__fixtures__/gbif-search-panda.json'
import taxonKingfisher from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-kingfisher.json'
import taxonPandaOleosa from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-panda-oleosa.json'
import { createFakeLookupDatabase } from '@/lib/services/gallery/lookups/lookupTestUtils'
import { isPlaceWithheldForThreat } from '@/lib/services/gallery/threatenedSpecies'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'

// A stored key whose record disagrees with the subject's names is set aside
// and the names are asked, under their own rules. The job resolves a synonym
// ("Parus caeruleus") or a FUZZY spelling to the accepted key but keeps the
// owner's own scientific name, so the record of that key never carries it:
// a later category-only edit or a common-name rename (which keeps the key)
// must still resolve, while "Panda" saved with the tree Panda oleosa's key
// still ends up `failed`. Only the network is stubbed, with the recorded
// fixtures.

type Answer = { statusCode: number; body: unknown }
const answers = new Map<string, Answer>()
const mockFetch = vi.fn(async ({ url }: { url: string }) => {
  const parsed = new URL(url)
  const answer = answers.get(parsed.pathname) ?? {
    statusCode: 404,
    body: '<!DOCTYPE html><html></html>'
  }
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

// The accepted taxon of the Parus caeruleus synonym, in the shape of the
// recorded `species/{key}` fixtures.
const taxonBlueTit = {
  ...taxonKingfisher,
  key: 2487879,
  nubKey: 2487879,
  taxonID: 'gbif:2487879',
  order: 'Passeriformes',
  family: 'Paridae',
  genus: 'Cyanistes',
  species: 'Cyanistes caeruleus',
  orderKey: 729,
  familyKey: 9327,
  genusKey: 2487875,
  speciesKey: 2487879,
  parentKey: 2487875,
  parent: 'Cyanistes',
  basionymKey: 8191482,
  basionym: 'Parus caeruleus Linnaeus, 1758',
  scientificName: 'Cyanistes caeruleus (Linnaeus, 1758)',
  canonicalName: 'Cyanistes caeruleus',
  vernacularName: 'Eurasian Blue Tit',
  authorship: '(Linnaeus, 1758) '
}

const lastPage = (search: object) => ({ ...search, endOfRecords: true })

const runJob = async (subject: Partial<MediaDetailsRecord>) => {
  const details = { ...subject, subjectLookupStatus: 'pending' as const }
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
    data: { mediaId: '7', retry: true }
  })

  expect(setMediaSubjectLookup).toHaveBeenCalledTimes(1)
  const { patch } = setMediaSubjectLookup.mock.calls[0][0]
  return {
    patch,
    withheld: isPlaceWithheldForThreat(
      { ...details, subjectIucnCategory: null, ...patch } as MediaDetailsRecord,
      { hideThreatenedPlaces: true }
    )
  }
}

const RESOLVED_BLUE_TIT = {
  subjectLookupStatus: 'resolved',
  subjectTaxonKey: '2487879',
  subjectIucnCategory: 'LC'
}

describe('a stored key whose record disagrees with the names', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    answers.clear()
    answers.set('/v1/species/2487879', { statusCode: 200, body: taxonBlueTit })
    answers.set('/v1/species/2475532', {
      statusCode: 200,
      body: taxonKingfisher
    })
    answers.set('/v1/species/5380987', {
      statusCode: 200,
      body: taxonPandaOleosa
    })
    for (const key of ['2487879', '2475532', '5380987']) {
      answers.set(`/v1/species/${key}/iucnRedListCategory`, {
        statusCode: 200,
        body: iucnLeastConcern
      })
    }
  })

  describe('a synonym the job resolved', () => {
    beforeEach(() => {
      answers.set('/v1/species/match', { statusCode: 200, body: matchSynonym })
    })

    const SYNONYM = {
      subjectName: 'Blue tit',
      subjectScientificName: 'Parus caeruleus',
      subjectCategory: null
    }

    it('resolves first through the match, keeping the owner’s name', async () => {
      const { patch, withheld } = await runJob({
        ...SYNONYM,
        subjectTaxonKey: null
      })

      expect(patch).toMatchObject(RESOLVED_BLUE_TIT)
      expect(withheld).toBe(false)
    })

    it.each([
      ['a category-only edit', { subjectCategory: 'bird' as const }],
      ['a common-name rename', { subjectName: 'Eurasian blue tit' }],
      [
        'a rename and a category edit',
        { subjectName: 'Eurasian blue tit', subjectCategory: 'bird' as const }
      ]
    ])('resolves again after %s keeps the key', async (_, edit) => {
      const { patch, withheld } = await runJob({
        ...SYNONYM,
        ...edit,
        subjectTaxonKey: '2487879'
      })

      expect(patch).toMatchObject(RESOLVED_BLUE_TIT)
      expect(withheld).toBe(false)
    })
  })

  it('resolves a FUZZY spelling again after a category-only edit', async () => {
    answers.set('/v1/species/match', { statusCode: 200, body: matchFuzzy })

    const { patch, withheld } = await runJob({
      subjectName: 'Common Kingfisher',
      subjectScientificName: 'Alcedo atthys',
      subjectCategory: 'bird',
      subjectTaxonKey: '2475532'
    })

    expect(patch).toMatchObject({
      subjectLookupStatus: 'resolved',
      subjectTaxonKey: '2475532',
      subjectIucnCategory: 'LC'
    })
    expect(withheld).toBe(false)
  })

  // Asked by its name, "Panda" filed as a mammal finds only the tree, in
  // another kingdom, so the names' own rule still fails it closed.
  it.each([
    ['one page', searchPanda],
    ['the last page', lastPage(searchPanda)]
  ])(
    'still records "Panda" with the Panda oleosa key failed (%s)',
    async (_, search) => {
      answers.set('/v1/species/search', { statusCode: 200, body: search })

      const { patch, withheld } = await runJob({
        subjectName: 'Panda',
        subjectScientificName: null,
        subjectCategory: 'mammal',
        subjectTaxonKey: '5380987'
      })

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    }
  )

  // A scientific name that GBIF cannot place keeps the disagreeing key's
  // place hidden: set aside, the key clears nothing on its own.
  it('records failed when the names find nothing', async () => {
    answers.set('/v1/species/match', {
      statusCode: 200,
      body: { confidence: 100, matchType: 'NONE', synonym: false }
    })

    const { patch, withheld } = await runJob({
      subjectName: 'Blue tit',
      subjectScientificName: 'Zzzqx blorp',
      subjectCategory: 'bird',
      subjectTaxonKey: '2487879'
    })

    expect(patch).toEqual({ subjectLookupStatus: 'failed' })
    expect(withheld).toBe(true)
  })
})
