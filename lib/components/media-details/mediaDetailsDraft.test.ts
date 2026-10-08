import type { MediaDetailsEntity } from '@/lib/services/medias/types'

import {
  PickedSubject,
  applySharedSections,
  diffDraft,
  draftFromDetails,
  isSubjectPicked,
  subjectPatch
} from './mediaDetailsDraft'

const details: MediaDetailsEntity = {
  subject: {
    name: 'Heron',
    scientificName: 'Ardea cinerea',
    category: 'bird',
    taxonKey: null,
    taxonPath: null,
    iucnCategory: null,
    threatStatus: 'unchecked',
    lookupStatus: null,
    lookupStale: false
  },
  takenAt: null,
  camera: { id: 'cam-1', name: 'Z9' },
  lens: null,
  exposure: null,
  place: {
    name: 'Marsh',
    latitude: 1,
    longitude: 2,
    precision: 'area',
    countryCode: null,
    nameSource: null,
    lookupStatus: null,
    lookupStale: false
  },
  inGallery: true,
  subjectSuggestions: null
}

describe('draftFromDetails', () => {
  it('maps missing details to empty strings', () => {
    expect(draftFromDetails('', false, null)).toEqual({
      description: '',
      decorative: false,
      inGallery: false,
      subjectName: '',
      subjectScientificName: '',
      subjectCategory: '',
      subjectTaxonKey: '',
      subjectTaxonPath: [],
      cameraGearId: '',
      lensGearId: '',
      placeName: '',
      placePrecision: ''
    })
  })

  it('reads every editable field from the details', () => {
    expect(draftFromDetails('A heron', false, details)).toMatchObject({
      description: 'A heron',
      inGallery: true,
      subjectName: 'Heron',
      subjectCategory: 'bird',
      cameraGearId: 'cam-1',
      placeName: 'Marsh',
      placePrecision: 'area'
    })
  })
})

describe('diffDraft', () => {
  const original = draftFromDetails('A heron', false, details)

  it('is empty when nothing changed', () => {
    expect(diffDraft(original, { ...original })).toEqual({})
  })

  it('contains only the changed keys', () => {
    expect(
      diffDraft(original, {
        ...original,
        description: ' Standing heron ',
        placePrecision: 'exact'
      })
    ).toEqual({ description: 'Standing heron', place_precision: 'exact' })
  })

  it('clears emptied values with null', () => {
    expect(
      diffDraft(original, {
        ...original,
        subjectName: ' ',
        cameraGearId: '',
        subjectCategory: ''
      })
    ).toEqual({
      subject_name: null,
      camera_gear_id: null,
      subject_category: null
    })
  })

  describe('taxon key', () => {
    const matched = draftFromDetails('A heron', false, {
      ...details,
      subject: {
        ...details.subject!,
        taxonKey: '2480826',
        taxonPath: ['Animalia', 'Chordata', 'Aves']
      }
    })

    it('reads the key and path from the details', () => {
      expect(matched).toMatchObject({
        subjectTaxonKey: '2480826',
        subjectTaxonPath: ['Animalia', 'Chordata', 'Aves']
      })
    })

    it('sends a new key, and null when it is cleared', () => {
      expect(
        diffDraft(original, { ...original, subjectTaxonKey: '5232437' })
      ).toEqual({ subject_taxon_key: '5232437' })
      expect(diffDraft(matched, { ...matched, subjectTaxonKey: '' })).toEqual({
        subject_taxon_key: null
      })
    })

    it('does not send an unchanged key on its own', () => {
      expect(diffDraft(matched, { ...matched })).toEqual({})
    })

    it('keeps a held key through a rename, which would otherwise clear it', () => {
      expect(
        diffDraft(matched, { ...matched, subjectName: 'Grey Heron' })
      ).toEqual({ subject_name: 'Grey Heron', subject_taxon_key: '2480826' })
    })

    it('does not invent a key for a rename of an unmatched subject', () => {
      expect(
        diffDraft(original, { ...original, subjectName: 'Grey Heron' })
      ).toEqual({ subject_name: 'Grey Heron' })
    })

    it.each(['abc', '1234567890123', '12 3'])(
      'never sends the malformed key %j',
      (key) => {
        expect(
          diffDraft(original, { ...original, subjectTaxonKey: key })
        ).toEqual({ subject_taxon_key: null })
      }
    )
  })

  it('saves a decorative item without a description', () => {
    expect(diffDraft(original, { ...original, decorative: true })).toEqual({
      description: null
    })
  })
})

describe('applySharedSections', () => {
  const source = draftFromDetails('', false, details)
  const target = draftFromDetails('Other', false, null)

  it('copies only the checked sections', () => {
    expect(
      applySharedSections(target, source, {
        gallery: false,
        gear: true,
        place: false
      })
    ).toEqual({ ...target, cameraGearId: 'cam-1', lensGearId: '' })
  })

  it('copies the gallery and place sections', () => {
    expect(
      applySharedSections(target, source, {
        gallery: true,
        gear: false,
        place: true
      })
    ).toEqual({
      ...target,
      inGallery: true,
      placeName: 'Marsh',
      placePrecision: 'area'
    })
  })
})

describe('picked subjects', () => {
  const picked: PickedSubject = {
    name: 'Warbling White-eye',
    scientificName: 'Zosterops japonicus',
    category: 'bird',
    taxonKey: '5232437',
    taxonPath: ['Animalia', 'Chordata', 'Aves']
  }

  it('fills every subject field of a draft', () => {
    expect(subjectPatch(picked)).toEqual({
      subjectName: 'Warbling White-eye',
      subjectScientificName: 'Zosterops japonicus',
      subjectCategory: 'bird',
      subjectTaxonKey: '5232437',
      subjectTaxonPath: ['Animalia', 'Chordata', 'Aves']
    })
  })

  it('recognises a draft that holds the subject, whatever the case', () => {
    const draft = {
      ...draftFromDetails('', false, null),
      ...subjectPatch({ ...picked, name: 'warbling white-eye ' })
    }
    expect(isSubjectPicked(draft, picked)).toBe(true)
    expect(isSubjectPicked({ ...draft, subjectTaxonKey: '' }, picked)).toBe(
      false
    )
    expect(isSubjectPicked(draftFromDetails('', false, null), picked)).toBe(
      false
    )
  })
})
