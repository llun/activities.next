import type { GalleryIndexRow } from '@/lib/database/domains/gallery/types'
import { buildIndexRow } from '@/lib/services/gallery/__fixtures__/galleryIndexRow'
import { OWNER_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import { getGalleryLifeList } from '@/lib/services/gallery/galleryQueries'
import { SPECIES_OR_LOWER_RANKS } from '@/lib/services/gallery/taxonRanks'
import { DEFAULT_GALLERY_SETTINGS } from '@/lib/types/database/gallery'

const read = (rows: GalleryIndexRow[]) =>
  getGalleryLifeList({
    database: {
      getGallerySettings: vi.fn().mockResolvedValue(DEFAULT_GALLERY_SETTINGS),
      getGalleryMediaIndex: vi.fn().mockResolvedValue(rows)
    } as unknown as Parameters<typeof getGalleryLifeList>[0]['database'],
    owner: { id: 'owner' },
    audience: OWNER_GALLERY_AUDIENCE
  })
const named = (
  id: number,
  name: string,
  rank: string | null,
  extra: Partial<GalleryIndexRow> = {}
) =>
  buildIndexRow(id, {
    subjectName: name,
    subjectCategory: 'bird',
    subjectTaxonRank: rank,
    subjectLookupStatus: 'resolved',
    ...extra
  })

describe('Life list rank evidence', () => {
  it('partitions names into species, groups and unknown while preserving old totals and fields', async () => {
    const result = await read([
      named(9, 'Bird', null),
      named(8, 'Pongo', 'GENUS', { subjectCategory: 'mammal' }),
      named(7, 'Corvidae', 'FAMILY'),
      named(6, 'Robin', null),
      named(5, 'Robin', 'SPECIES', {
        subjectTaxonKey: '1',
        placeName: 'Garden'
      }),
      named(4, 'Subspecies', 'SUBSPECIES', { subjectCategory: null }),
      named(3, 'Landscape', 'SPECIES', { subjectCategory: 'landscape' }),
      buildIndexRow(2)
    ])
    expect(result.total).toBe(5)
    expect(result.byCategory).toEqual({ bird: 3, mammal: 1 })
    expect(result.counts).toEqual({ species: 2, groups: 2, unknown: 1 })
    expect(Object.values(result.counts!).reduce((a, b) => a + b, 0)).toBe(
      result.total
    )
    expect(result.countsByCategory).toEqual({
      bird: { species: 1, groups: 1, unknown: 1 },
      mammal: { species: 0, groups: 1, unknown: 0 }
    })
    expect(result.entries.find((e) => e.name === 'Robin')).toEqual({
      key: 'name:robin',
      name: 'Robin',
      scientificName: null,
      category: 'bird',
      taxonKey: '1',
      taxonPath: null,
      taxonRank: 'SPECIES',
      identificationLevel: 'species',
      count: 2,
      coverMediaId: '6',
      countryCodes: [],
      firstSeenAt: '2026-09-12T12:00:00.000Z',
      lastSeenAt: '2026-09-12T12:00:00.000Z',
      firstPlaceName: 'Garden'
    })
    expect(result.entries.find((e) => e.name === 'Bird')).toMatchObject({
      taxonRank: null,
      identificationLevel: 'unknown'
    })
    expect(result.entries.find((e) => e.name === 'Pongo')).toMatchObject({
      taxonRank: 'GENUS',
      identificationLevel: 'group'
    })
  })

  it.each([...SPECIES_OR_LOWER_RANKS])(
    'accepts resolved %s evidence',
    async (rank) => {
      expect((await read([named(1, 'Taxon', rank)])).counts).toEqual({
        species: 1,
        groups: 0,
        unknown: 0
      })
    }
  )

  it.each([null, 'pending', 'failed', 'disabled', 'no-match'] as const)(
    'does not confirm a rank with status %s',
    async (status) => {
      const result = await read([
        named(1, 'Bird', 'SPECIES', { subjectLookupStatus: status })
      ])
      expect(result.counts).toEqual({ species: 0, groups: 0, unknown: 1 })
    }
  )

  it.each([
    ['SPECIES', 'GENUS', '1', '1'],
    ['SPECIES', 'SUBSPECIES', '1', '1'],
    ['SPECIES', 'SPECIES', '1', '2'],
    ['GENUS', 'FAMILY', '1', '1']
  ])(
    'withholds conflicting rank/key evidence %s %s %s %s',
    async (a, b, keyA, keyB) => {
      const rows = [
        named(2, 'Taxon', a, { subjectTaxonKey: keyA }),
        named(1, 'Taxon', b, { subjectTaxonKey: keyB })
      ]
      for (const input of [rows, [...rows].reverse()]) {
        expect((await read(input)).entries[0]).toMatchObject({
          identificationLevel: 'unknown',
          taxonRank: null,
          count: 2
        })
      }
    }
  )

  it('rejects unsupported ranks and unresolved conflicting evidence', async () => {
    const result = await read([
      named(3, 'Order', 'ORDER'),
      named(2, 'Taxon', 'SPECIES'),
      named(1, 'Taxon', 'GENUS', { subjectLookupStatus: 'pending' })
    ])
    expect(result.counts).toEqual({ species: 0, groups: 0, unknown: 2 })
  })
})
