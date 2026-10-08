import { Database } from '@/lib/database/types'
import { RESOLVE_MEDIA_SUBJECT_JOB_NAME } from '@/lib/jobs/names'
import { resolveMediaSubjectJob } from '@/lib/jobs/resolveMediaSubjectJob'
import iucnEndangered from '@/lib/services/gallery/lookups/__fixtures__/gbif-iucn-en.json'
import matchTiger from '@/lib/services/gallery/lookups/__fixtures__/gbif-match-tiger.json'
import taxonTiger from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-tiger.json'
import { createFakeLookupDatabase } from '@/lib/services/gallery/lookups/lookupTestUtils'
import { isPlaceWithheldForThreat } from '@/lib/services/gallery/threatenedSpecies'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'

// The real GBIF client, end to end through the job, with only the network
// stubbed: an answer the client cannot read must end as `failed` (place
// withheld), never as `resolved`/`NE` or `no-match` (place shown).

const answers = new Map<string, { statusCode: number; body: unknown }>()
const mockFetch = vi.fn(async ({ url }: { url: string }) => {
  const { pathname } = new URL(url)
  const answer = answers.get(pathname) ?? { statusCode: 404, body: '' }
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

const run = async () => {
  const lookups = createFakeLookupDatabase()
  const setMediaSubjectLookup = vi.fn().mockResolvedValue(true)
  const database = {
    ...lookups.spies,
    getMediaWithAttachedStatusIds: vi.fn().mockResolvedValue({
      media: { id: '7', details: TIGER },
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
    ...TIGER,
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
})
