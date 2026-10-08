import { Database } from '@/lib/database/types'
import { RESOLVE_MEDIA_SUBJECT_JOB_NAME } from '@/lib/jobs/names'
import { resolveMediaSubjectJob } from '@/lib/jobs/resolveMediaSubjectJob'
import matchGenus from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-genus.json'
import matchGenusOnly from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-higherrank-genus.json'
import matchPongoHigherRank from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-higherrank-pongo.json'
import matchNone from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-none.json'
import matchTiger from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-tiger.json'
import searchKingfisher from '@/lib/services/gallery/lookups/__fixtures__/gbif-search-kingfisher.json'
import taxonNotFound from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-not-found.json'
import taxonTiger from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-tiger.json'
import { createFakeLookupDatabase } from '@/lib/services/gallery/lookups/lookupTestUtils'
import { isPlaceWithheldForThreat } from '@/lib/services/gallery/threatenedSpecies'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'

// Property-style, end to end: the real job and GBIF client, with only the
// network stubbed. Each run draws a subject and an answer for every request
// from catalogues of odd GBIF answers. Whenever the stored result lets the
// place be shown, the answers GBIF actually served must be one of the
// allow-listed combinations, restated here from the answers' labels alone.

// Every client gets a provider with no request spacing and its own breaker,
// so hundreds of runs stay fast and one run's 500s do not open the next one's
// circuit.
vi.mock('@/lib/services/gallery/lookups/gbif', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/services/gallery/lookups/gbif')>()
  const { createTestProvider } =
    await import('@/lib/services/gallery/lookups/lookupTestUtils')
  return {
    ...original,
    createGbifClient: (deps: Parameters<typeof original.createGbifClient>[0]) =>
      original.createGbifClient({
        ...deps,
        provider: createTestProvider({ name: 'GBIF' })
      })
  }
})

type Served = { path: string; hinted: boolean; label: string }
const served: Served[] = []
let respond: (url: URL) => { label: string; statusCode: number; body: unknown }

const mockFetch = vi.fn(async ({ url }: { url: string }) => {
  const parsed = new URL(url)
  const answer = respond(parsed)
  served.push({
    path: parsed.pathname.replace('/v1/', ''),
    hinted: parsed.searchParams.has('kingdom'),
    label: answer.label
  })
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

// mulberry32: deterministic, so a failing run reproduces.
let seed = 0x5eed2026
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = seed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(values: readonly T[]): T =>
  values[Math.floor(random() * values.length)]

const HTML_404 = '<!DOCTYPE html><html><body>404 Not Found</body></html>'
type Catalogue = Record<string, { statusCode: number; body: unknown }>

const MATCH_ANSWERS: Catalogue = {
  none: { statusCode: 200, body: matchNone },
  'none-keyed': {
    statusCode: 200,
    body: { matchType: 'NONE', usageKey: 5219416 }
  },
  confident: { statusCode: 200, body: matchTiger },
  'confident-genus': { statusCode: 200, body: matchGenus },
  'confident-kingdom': {
    statusCode: 200,
    body: {
      usageKey: 6,
      canonicalName: 'Plantae',
      rank: 'KINGDOM',
      matchType: 'EXACT',
      confidence: 100
    }
  },
  'higherrank-species': { statusCode: 200, body: matchPongoHigherRank },
  'lowconf-species': {
    statusCode: 200,
    body: { ...matchPongoHigherRank, matchType: 'FUZZY', confidence: 70 }
  },
  'higherrank-genus': { statusCode: 200, body: matchGenusOnly },
  'higherrank-family': {
    statusCode: 200,
    body: {
      usageKey: 5483,
      canonicalName: 'Hominidae',
      rank: 'FAMILY',
      matchType: 'HIGHERRANK',
      confidence: 90,
      familyKey: 5483
    }
  },
  'higherrank-kingdom': {
    statusCode: 200,
    body: {
      usageKey: 6,
      canonicalName: 'Plantae',
      rank: 'KINGDOM',
      matchType: 'HIGHERRANK',
      confidence: 100,
      kingdomKey: 6
    }
  },
  'unknown-type': { statusCode: 200, body: { matchType: 'SOMETHING_NEW' } },
  'changed-shape': {
    statusCode: 200,
    body: { usage: { key: 5219416 }, diagnostics: { matchType: 'EXACT' } }
  },
  'exact-no-key': {
    statusCode: 200,
    body: { matchType: 'EXACT', confidence: 99, rank: 'SPECIES' }
  },
  'json-null': { statusCode: 200, body: 'null' },
  'json-string': { statusCode: 200, body: '"NONE"' },
  'not-json': { statusCode: 200, body: 'NONE' },
  'json-404': { statusCode: 404, body: taxonNotFound },
  'html-404': { statusCode: 404, body: HTML_404 },
  'server-error': { statusCode: 500, body: '' },
  'no-content': { statusCode: 204, body: '' }
}

const RANKS = ['SPECIES', 'SUBSPECIES', 'GENUS', 'FAMILY', 'ORDER', 'KINGDOM']
const taxonAnswers = (key: string): Catalogue => ({
  ...Object.fromEntries(
    RANKS.map((rank) => [
      `readable-${rank}`,
      {
        statusCode: 200,
        body: {
          ...taxonTiger,
          key: Number(key),
          nubKey: Number(key),
          speciesKey: undefined,
          rank
        }
      }
    ])
  ),
  'synonym-of-unknown': {
    statusCode: 200,
    body: {
      ...taxonTiger,
      key: Number(key),
      nubKey: Number(key),
      acceptedKey: 999
    }
  },
  'no-rank': {
    statusCode: 200,
    body: { ...taxonTiger, key: Number(key), nubKey: Number(key), rank: null }
  },
  'changed-shape': { statusCode: 200, body: { usage: { key: Number(key) } } },
  'json-null': { statusCode: 200, body: 'null' },
  'json-404': { statusCode: 404, body: taxonNotFound },
  'other-json-404': { statusCode: 404, body: { error: 'no route' } },
  'html-404': { statusCode: 404, body: HTML_404 },
  'server-error': { statusCode: 500, body: '' }
})

const IUCN_CODES = ['LC', 'NT', 'DD', 'NE', 'CR', 'EN', 'VU', 'EX', 'EW']
const IUCN_ANSWERS: Catalogue = {
  ...Object.fromEntries(
    IUCN_CODES.map((code) => [
      `code-${code}`,
      { statusCode: 200, body: { code, category: 'WHATEVER' } }
    ])
  ),
  'name-LC': { statusCode: 200, body: { category: 'LEAST_CONCERN' } },
  'name-EN': { statusCode: 200, body: { category: 'ENDANGERED' } },
  'not-assessed': { statusCode: 204, body: '' },
  'unknown-code': { statusCode: 200, body: { code: 'ZZ' } },
  'lower-case': { statusCode: 200, body: { code: 'lc' } },
  empty: { statusCode: 200, body: {} },
  list: { statusCode: 200, body: [] },
  'html-404': { statusCode: 404, body: HTML_404 },
  'json-404': { statusCode: 404, body: taxonNotFound },
  'server-error': { statusCode: 500, body: '' }
}

const SEARCH_ANSWERS: Catalogue = {
  // Names "Common Kingfisher" exactly (key 2475532), once, on the last page.
  'exact-hit': { statusCode: 200, body: searchKingfisher },
  'exact-hit-more-pages': {
    statusCode: 200,
    body: { ...searchKingfisher, endOfRecords: false }
  },
  'exact-hit-no-end-flag': {
    statusCode: 200,
    body: { ...searchKingfisher, endOfRecords: undefined }
  },
  'exact-hit-end-flag-string': {
    statusCode: 200,
    body: { ...searchKingfisher, endOfRecords: 'true' }
  },
  'two-exact-hits': {
    statusCode: 200,
    body: {
      ...searchKingfisher,
      results: [
        ...searchKingfisher.results,
        {
          ...searchKingfisher.results[1],
          vernacularNames: [
            { vernacularName: 'common kingfisher', language: 'eng' }
          ]
        }
      ]
    }
  },
  // The name is the 25th vernacular name, past the 20 kept for display.
  'exact-hit-late-name': {
    statusCode: 200,
    body: {
      endOfRecords: true,
      results: [
        {
          ...searchKingfisher.results[0],
          vernacularNames: [
            ...Array.from({ length: 24 }, (_, index) => ({
              vernacularName: `Name ${index}`,
              language: 'eng'
            })),
            { vernacularName: 'Common Kingfisher', language: 'fra' }
          ]
        }
      ]
    }
  },
  empty: { statusCode: 200, body: { results: [], endOfRecords: true } },
  'empty-more-pages': { statusCode: 200, body: { results: [] } },
  'readable-no-hit': {
    statusCode: 200,
    body: {
      endOfRecords: true,
      results: [
        { key: 5, canonicalName: 'Halcyon smyrnensis', rank: 'SPECIES' }
      ]
    }
  },
  partial: {
    statusCode: 200,
    body: {
      endOfRecords: true,
      results: [
        { junk: true },
        { key: 5, canonicalName: 'Halcyon smyrnensis', rank: 'SPECIES' }
      ]
    }
  },
  unreadable: { statusCode: 200, body: { results: [{ junk: true }] } },
  'not-a-list': { statusCode: 200, body: { results: {} } },
  'html-404': { statusCode: 404, body: HTML_404 },
  'server-error': { statusCode: 500, body: '' }
}

const SUBJECTS: Partial<MediaDetailsRecord>[] = [
  ...(['mammal', 'plant', 'bird', null, 'landscape'] as const).map(
    (subjectCategory) => ({
      subjectName: 'Tiger',
      subjectScientificName: 'Panthera tigris',
      subjectCategory,
      subjectTaxonKey: null
    })
  ),
  ...(['bird', 'plant'] as const).map((subjectCategory) => ({
    subjectName: 'Common Kingfisher',
    subjectScientificName: null,
    subjectCategory,
    subjectTaxonKey: null
  })),
  // Species-like only by its retired key: the category names no kingdom.
  {
    subjectName: 'Common Kingfisher',
    subjectScientificName: null,
    subjectCategory: 'landscape',
    subjectTaxonKey: '111'
  },
  {
    subjectName: null,
    subjectScientificName: null,
    subjectCategory: null,
    subjectTaxonKey: '5219416'
  },
  {
    subjectName: 'Tiger',
    subjectScientificName: 'Panthera tigris',
    subjectCategory: 'plant',
    subjectTaxonKey: '111'
  },
  {
    subjectName: 'Common Kingfisher',
    subjectScientificName: null,
    subjectCategory: 'bird',
    subjectTaxonKey: '111'
  },
  // A stored key that agrees with the names, and keys that do not: another
  // species' scientific name, a common name the record does not carry, a
  // category in another kingdom or another category in the same one. Every
  // record served below is the tiger's ("Panthera tigris", "tiger", a
  // mammal) under the key asked for.
  ...(['mammal', 'bird', 'plant', null] as const).map((subjectCategory) => ({
    subjectName: 'Tiger',
    subjectScientificName: 'Panthera tigris',
    subjectCategory,
    subjectTaxonKey: '5219416'
  })),
  {
    subjectName: 'Giant Panda',
    subjectScientificName: 'Ailuropoda melanoleuca',
    subjectCategory: 'mammal',
    subjectTaxonKey: '5219416'
  },
  ...(['Tiger', 'Vaquita'] as const).map((subjectName) => ({
    subjectName,
    subjectScientificName: null,
    subjectCategory: 'mammal' as const,
    subjectTaxonKey: '5219416'
  })),
  // Named only by a common name the record does not carry, but which a
  // search may list the key under.
  ...(['bird', null] as const).map((subjectCategory) => ({
    subjectName: 'Common Kingfisher',
    subjectScientificName: null,
    subjectCategory,
    subjectTaxonKey: '2475532'
  }))
]

const draw = (catalogue: Catalogue) => {
  const label = pick(Object.keys(catalogue))
  return { label, ...catalogue[label] }
}

// One draw per distinct request, so asking twice gets the same answer.
const createWorld = () => {
  const drawn = new Map<string, ReturnType<typeof draw>>()
  return (url: URL) => {
    const path = url.pathname.replace('/v1/', '')
    const id = `${path}?${url.searchParams.get('kingdom') ?? ''}`
    const existing = drawn.get(id)
    if (existing) return existing
    let answer: ReturnType<typeof draw>
    if (path === 'species/match') answer = draw(MATCH_ANSWERS)
    else if (path === 'species/search') answer = draw(SEARCH_ANSWERS)
    else if (/^species\/\d+\/iucnRedListCategory$/.test(path)) {
      answer = draw(IUCN_ANSWERS)
    } else if (path === 'species/999') {
      answer = { label: 'json-404', statusCode: 404, body: taxonNotFound }
    } else if (/^species\/\d+$/.test(path)) {
      answer = draw(taxonAnswers(path.split('/')[1]))
    } else {
      answer = { label: 'html-404', statusCode: 404, body: HTML_404 }
    }
    drawn.set(id, answer)
    return answer
  }
}

const CLEARING_IUCN = new Set([
  ...['LC', 'NT', 'DD', 'NE', 'EX', 'EW'].map((code) => `code-${code}`),
  'name-LC',
  // `{ code: 'lc' }`: the code is read case-insensitively, so this is LC.
  'lower-case',
  'not-assessed'
])
const UNCERTAIN_CLEARING_IUCN = new Set([
  ...['LC', 'NT', 'DD', 'NE'].map((code) => `code-${code}`),
  'name-LC',
  // `{ code: 'lc' }`: the code is read case-insensitively, so this is LC.
  'lower-case',
  'not-assessed'
])
// A genus or family never clears its place: only these do.
const SPECIES_RANKS = new Set(['readable-SPECIES', 'readable-SUBSPECIES'])
// Searches that name the subject exactly once, on GBIF's last page, with
// every result readable.
const CONFIRMING_SEARCHES = new Set(['exact-hit', 'exact-hit-late-name'])
// The categories whose kingdom is the taxon fixtures' (Animalia).
const ANIMAL_CATEGORIES = new Set(['bird', 'mammal'])
// The categories that name a kingdom, among the subjects drawn.
const LIVING_CATEGORIES = new Set(['bird', 'mammal', 'plant'])
// Searches that list key 2475532 as a result named "Common Kingfisher"
// exactly, whatever else they say.
const NAMING_SEARCHES = new Set([
  'exact-hit',
  'exact-hit-more-pages',
  'exact-hit-no-end-flag',
  'exact-hit-end-flag-string',
  'two-exact-hits',
  'exact-hit-late-name'
])

/**
 * Whether a stored key's record (always the tiger's, under that key) agrees
 * with the subject: the scientific name is the tiger's, or with none, the
 * common name is one of its vernacular names; a living category is the
 * record's own (a mammal).
 */
const storedKeyAgrees = (subject: Partial<MediaDetailsRecord>) => {
  const category = subject.subjectCategory ?? null
  if (category && LIVING_CATEGORIES.has(category) && category !== 'mammal') {
    return false
  }
  if (subject.subjectScientificName) {
    return subject.subjectScientificName === 'Panthera tigris'
  }
  if (subject.subjectName) {
    if (subject.subjectName.toLowerCase() === 'tiger') return true
    return (
      subject.subjectName === 'Common Kingfisher' &&
      subject.subjectTaxonKey === '2475532' &&
      NAMING_SEARCHES.has(labelOf('species/search') ?? '')
    )
  }
  return true
}

const labelOf = (path: string) =>
  served.filter((answer) => answer.path === path).at(-1)?.label

/**
 * The allow-list, from what GBIF served: exactly one species-rank taxon
 * whose category was read and is not CR, EN or VU.
 */
const allowedToShow = (
  subject: Partial<MediaDetailsRecord>,
  patch: Record<string, unknown>
): string | null => {
  // `no-match` (and anything but `resolved`) never shows a place.
  if (patch.subjectLookupStatus !== 'resolved') return null
  const key = patch.subjectTaxonKey as string | undefined
  const lastMatch = served
    .filter((answer) => answer.path === 'species/match')
    .at(-1)

  if (!key) {
    // The species an unhinted, unconfident match placed the name in. A
    // subject confirmed by a key once is never cleared by such a guess.
    if (subject.subjectTaxonKey || !subject.subjectScientificName) return null
    if (!lastMatch || lastMatch.hinted) return null
    return (lastMatch.label === 'higherrank-species' ||
      lastMatch.label === 'lowconf-species') &&
      SPECIES_RANKS.has(labelOf('species/5707420') ?? '') &&
      UNCERTAIN_CLEARING_IUCN.has(
        labelOf('species/5707420/iucnRedListCategory') ?? ''
      )
      ? 'uncertain-species-not-threatened'
      : null
  }

  if (
    !SPECIES_RANKS.has(labelOf(`species/${key}`) ?? '') ||
    !CLEARING_IUCN.has(labelOf(`species/${key}/iucnRedListCategory`) ?? '')
  ) {
    return null
  }
  if (key === subject.subjectTaxonKey) {
    // A stored key never clears a place for names its record disagrees with.
    if (!storedKeyAgrees(subject)) return null
    return subject.subjectScientificName || !subject.subjectName
      ? 'stored-key-species'
      : 'stored-key-common-name'
  }
  if (subject.subjectScientificName) {
    return lastMatch?.label === 'confident' ? 'match-species' : null
  }
  return CONFIRMING_SEARCHES.has(labelOf('species/search') ?? '') &&
    ANIMAL_CATEGORIES.has(subject.subjectCategory ?? '')
    ? 'search-single-exact-hit'
    : null
}

const RUNS = 4000

describe('resolveMediaSubjectJob never shows a place off the allow-list', () => {
  it(`holds for ${RUNS} random combinations of GBIF answers`, async () => {
    const reached = new Map<string, number>()
    for (let index = 0; index < RUNS; index += 1) {
      served.length = 0
      respond = createWorld()
      const subject = {
        ...pick(SUBJECTS),
        subjectLookupStatus: 'pending' as const
      }

      const lookups = createFakeLookupDatabase()
      const setMediaSubjectLookup = vi.fn().mockResolvedValue(true)
      const database = {
        ...lookups.spies,
        getMediaWithAttachedStatusIds: vi.fn().mockResolvedValue({
          media: { id: '7', details: subject },
          statusIds: []
        }),
        setMediaSubjectLookup
      } as unknown as Database

      await resolveMediaSubjectJob(database, {
        id: `job-${index}`,
        name: RESOLVE_MEDIA_SUBJECT_JOB_NAME,
        data: { mediaId: '7' }
      })

      expect(setMediaSubjectLookup).toHaveBeenCalledTimes(1)
      const { patch } = setMediaSubjectLookup.mock.calls[0][0]
      const stored = {
        ...subject,
        subjectIucnCategory: null,
        ...patch
      } as MediaDetailsRecord
      // Never written any more.
      expect(patch.subjectLookupStatus).not.toBe('no-match')
      const shown = !isPlaceWithheldForThreat(stored, {
        hideThreatenedPlaces: true
      })
      if (!shown) continue

      const allowed = allowedToShow(subject, patch)
      // On failure, the subject and every answer served say why.
      expect(
        allowed,
        JSON.stringify({ subject, served, patch }, null, 2)
      ).not.toBeNull()
      reached.set(allowed as string, (reached.get(allowed as string) ?? 0) + 1)
    }
    // Every allow-listed answer was drawn, so the check is not vacuous.
    expect([...reached.keys()].sort()).toEqual([
      'match-species',
      'search-single-exact-hit',
      'stored-key-common-name',
      'stored-key-species',
      'uncertain-species-not-threatened'
    ])
  })
})
