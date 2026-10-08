import {
  getSubjectThreatStatus,
  isPlaceWithheldForThreat,
  isSpeciesLike
} from '@/lib/services/gallery/threatenedSpecies'
import { EMPTY_MEDIA_DETAILS } from '@/lib/types/database/gallery'

const subject = (overrides: Partial<typeof EMPTY_MEDIA_DETAILS>) => ({
  ...EMPTY_MEDIA_DETAILS,
  ...overrides
})

describe('isSpeciesLike', () => {
  it.each([
    ['a taxon key', { subjectTaxonKey: '5228' }, true],
    ['a scientific name', { subjectScientificName: 'Alcedo atthis' }, true],
    [
      'a bird by common name',
      { subjectName: 'Kingfisher', subjectCategory: 'bird' as const },
      true
    ],
    [
      'a fungus by common name',
      { subjectName: 'Fly agaric', subjectCategory: 'fungus' as const },
      true
    ],
    [
      'a landscape',
      { subjectName: 'Doi Suthep', subjectCategory: 'landscape' as const },
      false
    ],
    [
      'an other',
      { subjectName: 'Bridge', subjectCategory: 'other' as const },
      false
    ],
    ['a common name with no category', { subjectName: 'Kingfisher' }, false],
    [
      'a blank scientific name',
      { subjectScientificName: '   ', subjectCategory: 'bird' as const },
      false
    ],
    ['a blank taxon key', { subjectTaxonKey: ' ' }, false],
    ['nothing', {}, false]
  ])('%s: %s', (_, overrides, expected) => {
    expect(isSpeciesLike(subject(overrides))).toBe(expected)
  })
})

describe('isPlaceWithheldForThreat', () => {
  const species = subject({ subjectScientificName: 'Buceros bicornis' })

  it('fails closed when the setting is somehow missing', () => {
    expect(
      isPlaceWithheldForThreat(species, {
        hideThreatenedPlaces: undefined as unknown as boolean
      })
    ).toBeTrue()
  })

  it('never withholds when the owner turns it off', () => {
    expect(
      isPlaceWithheldForThreat(species, { hideThreatenedPlaces: false })
    ).toBeFalse()
  })
})

describe('getSubjectThreatStatus', () => {
  it.each([
    [
      'resolved VU',
      {
        subjectLookupStatus: 'resolved' as const,
        subjectIucnCategory: 'VU' as const
      },
      'threatened'
    ],
    [
      'resolved LC',
      {
        subjectLookupStatus: 'resolved' as const,
        subjectIucnCategory: 'LC' as const
      },
      'not-threatened'
    ],
    [
      'no-match',
      { subjectLookupStatus: 'no-match' as const },
      'not-threatened'
    ],
    ['pending', { subjectLookupStatus: 'pending' as const }, 'unchecked'],
    ['failed', { subjectLookupStatus: 'failed' as const }, 'unchecked'],
    ['never looked up', {}, 'unchecked'],
    [
      'resolved with no category',
      { subjectLookupStatus: 'resolved' as const },
      'unchecked'
    ]
  ])('a species %s is %s', (_, lookup, expected) => {
    expect(
      getSubjectThreatStatus(
        subject({ subjectScientificName: 'Buceros bicornis', ...lookup })
      )
    ).toBe(expected)
  })

  it('has nothing to check for a subject that is not species-like', () => {
    expect(
      getSubjectThreatStatus(
        subject({ subjectName: 'Sunset', subjectCategory: 'landscape' })
      )
    ).toBe('not-threatened')
  })
})
