import { candidateToPicked } from '@/lib/components/media-details/subjectChoices'
import { Database } from '@/lib/database/types'
import { RESOLVE_MEDIA_SUBJECT_JOB_NAME } from '@/lib/jobs/names'
import { resolveMediaSubjectJob } from '@/lib/jobs/resolveMediaSubjectJob'
import iucnLeastConcern from '@/lib/services/gallery/lookups/__fixtures__/gbif-iucn-lc.json'
import searchPanda from '@/lib/services/gallery/lookups/__fixtures__/gbif-search-panda.json'
import searchVaquita from '@/lib/services/gallery/lookups/__fixtures__/gbif-search-vaquita.json'
import taxonCalligrapha from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-calligrapha.json'
import taxonPandaOleosa from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-panda-oleosa.json'
import { createGbifClient } from '@/lib/services/gallery/lookups/gbif'
import { createFakeLookupDatabase } from '@/lib/services/gallery/lookups/lookupTestUtils'
import { suggestSubjects } from '@/lib/services/gallery/subjects/suggestSubjects'
import { isPlaceWithheldForThreat } from '@/lib/services/gallery/threatenedSpecies'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'

// The suggestions route and the subject job together, with the real GBIF
// client and only the network stubbed by the recorded fixtures. A chip the
// owner picks is saved as it is, its taxon key included, so a key a
// suggestion attaches must never make a threatened species' place public:
// "Panda" (the giant panda, VU) is also the tree Panda oleosa (LC), and
// "Vaquita" (CR) is also the beetle Calligrapha mexicana.

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

const visionAnswer = vi.hoisted(() => ({ text: '' }))
vi.mock('@/lib/services/altText/openai', () => ({
  requestVisionCompletion: async () => visionAnswer.text
}))

const CONFIG = { endpoint: 'https://vision.test/v1', apiKey: 'k', model: 'm' }

const lastPage = (search: object) => ({
  ...search,
  endOfRecords: true
})

const suggest = async (name: string) => {
  visionAnswer.text = JSON.stringify({
    subjects: [
      { name, scientificName: null, category: 'mammal', confidence: 0.92 }
    ],
    group: 'mammal'
  })
  const lookups = createFakeLookupDatabase()
  return suggestSubjects({
    config: CONFIG,
    image: { buffer: Buffer.from('jpeg'), mimeType: 'image/jpeg' },
    gbif: createGbifClient({ database: lookups.database })
  })
}

// The owner's save of the subject, as the dialog's draft sends it.
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
    data: { mediaId: '7' }
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

const saveChip = async (name: string) => {
  const suggestions = await suggest(name)
  const picked = candidateToPicked(suggestions.candidates[0])
  return {
    candidate: suggestions.candidates[0],
    ...(await runJob({
      subjectName: picked.name,
      subjectScientificName: picked.scientificName || null,
      subjectCategory: picked.category || null,
      subjectTaxonKey: picked.taxonKey || null
    }))
  }
}

describe('a picked suggestion through the subject job', () => {
  beforeEach(() => {
    mockFetch.mockClear()
    answers.clear()
    answers.set('/v1/species/5380987', {
      statusCode: 200,
      body: taxonPandaOleosa
    })
    answers.set('/v1/species/11125184', {
      statusCode: 200,
      body: taxonCalligrapha
    })
    for (const key of ['5380987', '11125184']) {
      answers.set(`/v1/species/${key}/iucnRedListCategory`, {
        statusCode: 200,
        body: iucnLeastConcern
      })
    }
  })

  it.each([
    ['Panda', searchPanda],
    ['Panda', lastPage(searchPanda)],
    ['Vaquita', searchVaquita],
    ['Vaquita', lastPage(searchVaquita)]
  ])(
    'leaves "%s" unchecked and keeps its place withheld',
    async (name, search) => {
      answers.set('/v1/species/search', { statusCode: 200, body: search })

      const { candidate, patch, withheld } = await saveChip(name)

      expect(candidate).toMatchObject({
        name,
        scientificName: null,
        category: 'mammal',
        taxonKey: null,
        taxonPath: []
      })
      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    }
  )

  // A chip stored before the fix, a stale picker or an API client can still
  // carry the wrong species' key: the job checks it against the names.
  it.each([
    ['Panda', '5380987', searchPanda],
    ['Vaquita', '11125184', searchVaquita]
  ])(
    'keeps "%s" withheld when it is saved with another species’ key',
    async (name, key, search) => {
      answers.set('/v1/species/search', { statusCode: 200, body: search })

      const { patch, withheld } = await runJob({
        subjectName: name,
        subjectScientificName: null,
        subjectCategory: 'mammal',
        subjectTaxonKey: key
      })

      expect(patch).toEqual({ subjectLookupStatus: 'failed' })
      expect(withheld).toBe(true)
    }
  )
})
