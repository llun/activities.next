import { Database } from '@/lib/database/types'
import { RESOLVE_MEDIA_SUBJECT_JOB_NAME } from '@/lib/jobs/names'
import { resolveMediaSubjectJob } from '@/lib/jobs/resolveMediaSubjectJob'
import { createGbifClient } from '@/lib/services/gallery/lookups/gbif'
import { LookupError } from '@/lib/services/gallery/lookups/lookupRequest'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'

const gbif = {
  lookupMatch: vi.fn(),
  getTaxon: vi.fn(),
  getIucnCategory: vi.fn(),
  searchTaxa: vi.fn(),
  lookupSearch: vi.fn()
}
vi.mock('@/lib/services/gallery/lookups/gbif', () => ({
  createGbifClient: vi.fn(() => gbif)
}))

const resolvedSettings = { network: { speciesLookups: true } }
vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn(async () => resolvedSettings)
}))

const getMediaWithAttachedStatusIds = vi.fn()
const setMediaSubjectLookup = vi.fn()
const database = {
  getMediaWithAttachedStatusIds,
  setMediaSubjectLookup
} as unknown as Database

const message = (data: unknown) => ({
  id: 'job-1',
  name: RESOLVE_MEDIA_SUBJECT_JOB_NAME,
  data
})

const mediaWith = (details: Partial<MediaDetailsRecord>) =>
  getMediaWithAttachedStatusIds.mockResolvedValue({
    media: { id: '7', details },
    statusIds: []
  })

const KINGFISHER = {
  taxonKey: '2475532',
  scientificName: 'Alcedo atthis',
  rank: 'SPECIES',
  taxonPath: ['Animalia', 'Chordata', 'Aves', 'Coraciiformes', 'Alcedinidae'],
  category: 'bird',
  vernacularName: 'Common Kingfisher',
  iucnCategory: 'LC'
}

describe('resolveMediaSubjectJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolvedSettings.network.speciesLookups = true
    setMediaSubjectLookup.mockResolvedValue(true)
    gbif.lookupMatch.mockResolvedValue({
      kind: 'match',
      taxon: { taxonKey: KINGFISHER.taxonKey }
    })
    gbif.getTaxon.mockResolvedValue(KINGFISHER)
    gbif.searchTaxa.mockResolvedValue([])
    gbif.lookupSearch.mockResolvedValue({ results: [], complete: true })
  })

  it('ignores a malformed message', async () => {
    await resolveMediaSubjectJob(database, message({ nope: true }))
    await resolveMediaSubjectJob(database, message({ mediaId: '' }))

    expect(getMediaWithAttachedStatusIds).not.toHaveBeenCalled()
  })

  it('does nothing for a media that is gone', async () => {
    getMediaWithAttachedStatusIds.mockResolvedValue(null)
    await resolveMediaSubjectJob(database, message({ mediaId: '7' }))
    expect(setMediaSubjectLookup).not.toHaveBeenCalled()
  })

  it('resolves a scientific name: match, then taxon with its IUCN category', async () => {
    mediaWith({
      subjectName: 'Common Kingfisher',
      subjectScientificName: 'Alcedo atthis',
      subjectCategory: 'bird',
      subjectLookupStatus: 'pending'
    })

    await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

    expect(gbif.lookupMatch).toHaveBeenCalledTimes(1)
    expect(gbif.lookupMatch).toHaveBeenCalledWith('Alcedo atthis', {
      kingdom: 'Animalia',
      allowHigherRank: true
    })
    expect(gbif.getTaxon).toHaveBeenCalledWith('2475532')
    expect(setMediaSubjectLookup).toHaveBeenCalledWith({
      mediaId: '7',
      expect: {
        subjectName: 'Common Kingfisher',
        subjectScientificName: 'Alcedo atthis',
        subjectTaxonKey: null,
        subjectCategory: 'bird'
      },
      patch: {
        subjectTaxonKey: '2475532',
        subjectTaxonPath: KINGFISHER.taxonPath,
        subjectIucnCategory: 'LC',
        subjectLookupStatus: 'resolved'
      }
    })
  })

  it('writes NE when GBIF answers it has no assessment', async () => {
    gbif.getTaxon.mockResolvedValue({ ...KINGFISHER, iucnCategory: null })
    mediaWith({ subjectScientificName: 'Alcedo atthis' })

    await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

    expect(setMediaSubjectLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          subjectIucnCategory: 'NE',
          subjectLookupStatus: 'resolved'
        })
      })
    )
  })

  it('asks GBIF again past a remembered failure only on a retry', async () => {
    mediaWith({ subjectScientificName: 'Alcedo atthis' })

    await resolveMediaSubjectJob(database, message({ mediaId: '7' }))
    expect(createGbifClient).toHaveBeenLastCalledWith(
      expect.objectContaining({ skipCachedErrors: false })
    )

    await resolveMediaSubjectJob(
      database,
      message({ mediaId: '7', retry: true })
    )
    expect(createGbifClient).toHaveBeenLastCalledWith(
      expect.objectContaining({ skipCachedErrors: true })
    )
  })

  it('records a threatened category', async () => {
    gbif.getTaxon.mockResolvedValue({ ...KINGFISHER, iucnCategory: 'EN' })
    mediaWith({ subjectScientificName: 'Panthera tigris' })

    await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

    expect(setMediaSubjectLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          subjectIucnCategory: 'EN',
          subjectLookupStatus: 'resolved'
        })
      })
    )
  })

  it('reads a known taxon key directly, without matching', async () => {
    mediaWith({
      subjectName: 'Common Kingfisher',
      subjectTaxonKey: '2475532',
      subjectCategory: 'bird'
    })

    await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

    expect(gbif.lookupMatch).not.toHaveBeenCalled()
    expect(gbif.getTaxon).toHaveBeenCalledWith('2475532')
    expect(setMediaSubjectLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        expect: expect.objectContaining({ subjectTaxonKey: '2475532' })
      })
    )
  })

  it('finds a common name through the search when there is no scientific name', async () => {
    gbif.lookupSearch.mockResolvedValue({
      complete: true,
      results: [
        { taxonKey: '1', scientificName: 'Other', vernacularNames: ['Other'] },
        {
          taxonKey: '2475532',
          scientificName: 'Alcedo atthis',
          vernacularNames: ['European Kingfisher', 'common  KINGFISHER']
        }
      ]
    })
    mediaWith({ subjectName: 'Common Kingfisher', subjectCategory: 'bird' })

    await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

    expect(gbif.lookupSearch).toHaveBeenCalledWith('Common Kingfisher')
    expect(gbif.getTaxon).toHaveBeenCalledWith('2475532')
    expect(setMediaSubjectLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ subjectLookupStatus: 'resolved' })
      })
    )
  })

  it('does not accept a near miss from the search', async () => {
    gbif.lookupSearch.mockResolvedValue({
      complete: true,
      results: [
        {
          taxonKey: '5',
          scientificName: 'Halcyon smyrnensis',
          vernacularNames: ['White-throated Kingfisher']
        }
      ]
    })
    mediaWith({ subjectName: 'Kingfisher', subjectCategory: 'bird' })

    await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

    expect(gbif.getTaxon).not.toHaveBeenCalled()
    expect(setMediaSubjectLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: {
          subjectIucnCategory: null,
          subjectTaxonPath: null,
          subjectLookupStatus: 'no-match'
        }
      })
    )
  })

  it('records failed when some search results could not be read', async () => {
    gbif.lookupSearch.mockResolvedValue({ complete: false, results: [] })
    mediaWith({ subjectName: 'Kingfisher', subjectCategory: 'bird' })

    await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

    expect(setMediaSubjectLookup).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { subjectLookupStatus: 'failed' } })
    )
  })

  it('records no-match when GBIF answers NONE without a hint', async () => {
    gbif.lookupMatch.mockResolvedValue({ kind: 'none' })
    mediaWith({ subjectScientificName: 'Alcdo athis typo' })

    await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

    expect(gbif.lookupMatch).toHaveBeenCalledTimes(1)
    expect(setMediaSubjectLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ subjectLookupStatus: 'no-match' })
      })
    )
  })

  describe('a kingdom hint', () => {
    it.each([
      ['NONE', { kind: 'none' }],
      ['a kingdom (unplaced)', { kind: 'unplaced' }],
      [
        'an uncertain answer',
        { kind: 'uncertain', uncertain: { speciesKey: '1', genusKey: null } }
      ]
    ])(
      'is dropped and the name asked again when the hinted answer is %s',
      async (_, hinted) => {
        gbif.lookupMatch.mockResolvedValueOnce(hinted).mockResolvedValueOnce({
          kind: 'match',
          taxon: { taxonKey: '5219416' }
        })
        gbif.getTaxon.mockResolvedValue({
          ...KINGFISHER,
          taxonKey: '5219416',
          iucnCategory: 'EN'
        })
        mediaWith({
          subjectScientificName: 'Panthera tigris',
          subjectCategory: 'plant'
        })

        await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

        expect(gbif.lookupMatch).toHaveBeenNthCalledWith(1, 'Panthera tigris', {
          kingdom: 'Plantae',
          allowHigherRank: true
        })
        expect(gbif.lookupMatch).toHaveBeenNthCalledWith(2, 'Panthera tigris', {
          allowHigherRank: true
        })
        expect(setMediaSubjectLookup).toHaveBeenCalledWith(
          expect.objectContaining({
            patch: expect.objectContaining({
              subjectIucnCategory: 'EN',
              subjectLookupStatus: 'resolved'
            })
          })
        )
      }
    )

    it('records failed when the unhinted answer places the name in a kingdom', async () => {
      gbif.lookupMatch.mockResolvedValue({ kind: 'unplaced' })
      mediaWith({
        subjectScientificName: 'Panthera tigris',
        subjectCategory: 'plant'
      })

      await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

      expect(gbif.lookupMatch).toHaveBeenCalledTimes(2)
      expect(setMediaSubjectLookup).toHaveBeenCalledWith(
        expect.objectContaining({ patch: { subjectLookupStatus: 'failed' } })
      )
    })

    it('records no-match only for the unhinted NONE', async () => {
      gbif.lookupMatch
        .mockResolvedValueOnce({ kind: 'none' })
        .mockResolvedValueOnce({ kind: 'none' })
      mediaWith({
        subjectScientificName: 'Zzzqx blorp',
        subjectCategory: 'bird'
      })

      await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

      expect(gbif.lookupMatch).toHaveBeenCalledTimes(2)
      expect(setMediaSubjectLookup).toHaveBeenCalledWith(
        expect.objectContaining({
          patch: expect.objectContaining({ subjectLookupStatus: 'no-match' })
        })
      )
    })
  })

  describe('a key GBIF does not know', () => {
    it('records failed for a stored key with no name to try', async () => {
      gbif.getTaxon.mockResolvedValue(null)
      mediaWith({ subjectTaxonKey: '99999999' })

      await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

      expect(setMediaSubjectLookup).toHaveBeenCalledWith(
        expect.objectContaining({ patch: { subjectLookupStatus: 'failed' } })
      )
    })

    it('records failed when the names of a retired key only give NONE', async () => {
      gbif.getTaxon.mockResolvedValue(null)
      gbif.lookupMatch.mockResolvedValue({ kind: 'none' })
      mediaWith({ subjectTaxonKey: '99999999', subjectScientificName: 'X y' })

      await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

      expect(setMediaSubjectLookup).toHaveBeenCalledWith(
        expect.objectContaining({ patch: { subjectLookupStatus: 'failed' } })
      )
    })

    it.each([
      ['a confident match', { scientific: true }],
      ['an exact search hit', { scientific: false }]
    ])('records failed for the key of %s', async (_, { scientific }) => {
      gbif.getTaxon.mockResolvedValue(null)
      gbif.lookupSearch.mockResolvedValue({
        complete: true,
        results: [
          {
            taxonKey: '2475532',
            scientificName: 'Alcedo atthis',
            vernacularNames: ['Common Kingfisher']
          }
        ]
      })
      mediaWith(
        scientific
          ? { subjectScientificName: 'Alcedo atthis' }
          : { subjectName: 'Common Kingfisher', subjectCategory: 'bird' }
      )

      await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

      expect(gbif.getTaxon).toHaveBeenCalledWith('2475532')
      expect(setMediaSubjectLookup).toHaveBeenCalledWith(
        expect.objectContaining({ patch: { subjectLookupStatus: 'failed' } })
      )
    })
  })

  it('compares the category, so a result for an older category is dropped', async () => {
    mediaWith({
      subjectScientificName: 'Panthera tigris',
      subjectCategory: 'plant'
    })

    await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

    expect(setMediaSubjectLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        expect: expect.objectContaining({ subjectCategory: 'plant' })
      })
    )
  })

  describe('a subject that is not species-like', () => {
    it('clears a stale status and looks nothing up', async () => {
      mediaWith({
        subjectName: 'Mountain at dawn',
        subjectCategory: 'landscape',
        subjectLookupStatus: 'pending'
      })

      await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

      expect(gbif.lookupMatch).not.toHaveBeenCalled()
      expect(setMediaSubjectLookup).toHaveBeenCalledWith(
        expect.objectContaining({ patch: { subjectLookupStatus: null } })
      )
    })

    it('writes nothing when there is no status to clear', async () => {
      mediaWith({ subjectName: 'Mountain', subjectCategory: 'landscape' })

      await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

      expect(setMediaSubjectLookup).not.toHaveBeenCalled()
    })
  })

  describe('the species lookups switch', () => {
    it('is re-checked at run time: off records disabled and sends nothing', async () => {
      resolvedSettings.network.speciesLookups = false
      mediaWith({
        subjectScientificName: 'Alcedo atthis',
        subjectLookupStatus: 'pending'
      })

      await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

      expect(gbif.lookupMatch).not.toHaveBeenCalled()
      expect(gbif.getTaxon).not.toHaveBeenCalled()
      expect(setMediaSubjectLookup).toHaveBeenCalledWith(
        expect.objectContaining({
          patch: { subjectLookupStatus: 'disabled' }
        })
      )
    })

    it.each(['resolved', 'no-match'] as const)(
      'keeps a %s result that is still valid',
      async (status) => {
        resolvedSettings.network.speciesLookups = false
        mediaWith({
          subjectScientificName: 'Alcedo atthis',
          subjectLookupStatus: status
        })

        await resolveMediaSubjectJob(database, message({ mediaId: '7' }))

        expect(setMediaSubjectLookup).not.toHaveBeenCalled()
      }
    )
  })

  it('drops the result when the subject was edited meanwhile (compare-and-set loses)', async () => {
    setMediaSubjectLookup.mockResolvedValue(false)
    mediaWith({ subjectScientificName: 'Alcedo atthis' })

    await expect(
      resolveMediaSubjectJob(database, message({ mediaId: '7' }))
    ).resolves.toBeUndefined()

    expect(setMediaSubjectLookup).toHaveBeenCalledTimes(1)
  })

  describe('provider errors', () => {
    it.each([
      ['a lookup error', new LookupError('unavailable', 'GBIF answered 503')],
      ['an unexpected error', new Error('boom')]
    ])('%s is swallowed and persisted as failed', async (_label, error) => {
      gbif.lookupMatch.mockRejectedValue(error)
      mediaWith({
        subjectScientificName: 'Alcedo atthis',
        subjectLookupStatus: 'pending'
      })

      await expect(
        resolveMediaSubjectJob(database, message({ mediaId: '7' }))
      ).resolves.toBeUndefined()

      expect(setMediaSubjectLookup).toHaveBeenCalledWith(
        expect.objectContaining({ patch: { subjectLookupStatus: 'failed' } })
      )
    })

    it('still returns when recording the failure fails too', async () => {
      gbif.lookupMatch.mockRejectedValue(new Error('boom'))
      setMediaSubjectLookup.mockRejectedValue(new Error('db down'))
      mediaWith({ subjectScientificName: 'Alcedo atthis' })

      await expect(
        resolveMediaSubjectJob(database, message({ mediaId: '7' }))
      ).resolves.toBeUndefined()
    })
  })
})
