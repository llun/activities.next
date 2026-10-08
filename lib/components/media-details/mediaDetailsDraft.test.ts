import type { MediaDetailsEntity } from '@/lib/services/medias/types'

import {
  applySharedSections,
  diffDraft,
  draftFromDetails
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
    lookupStatus: null
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
    lookupStatus: null
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
