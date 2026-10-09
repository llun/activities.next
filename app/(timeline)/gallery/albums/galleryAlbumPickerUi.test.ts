import {
  filterPickerItems,
  getPickerPlaceNames,
  getPickerSubjectNames
} from '@/app/(timeline)/gallery/albums/galleryAlbumPickerUi'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'

const placeOf = (name: string | null) =>
  ({
    name,
    precision: 'exact',
    latitude: 1,
    longitude: 2,
    countryCode: 'GB'
  }) as GalleryItemEntity['place']

const items = [
  buildGalleryItem('1', {
    takenAt: '2026-05-02T10:00:00Z',
    place: placeOf('Lee Valley')
  }),
  buildGalleryItem('2', {
    takenAt: '2026-06-21T10:00:00Z',
    place: placeOf('Hyde Park')
  }),
  buildGalleryItem('3', { takenAt: null, place: placeOf('Hyde Park') }),
  buildGalleryItem('4', { takenAt: '2026-06-22T10:00:00Z', place: null })
]

describe('getPickerPlaceNames', () => {
  it('lists each name once, sorted, skipping photos without a place', () => {
    expect(getPickerPlaceNames(items)).toEqual(['Hyde Park', 'Lee Valley'])
  })
})

describe('filterPickerItems', () => {
  const ids = (found: GalleryItemEntity[]) => found.map((item) => item.mediaId)

  it('returns everything without a filter', () => {
    expect(filterPickerItems(items, { place: '', from: '', to: '' })).toBe(
      items
    )
  })

  it('filters by place', () => {
    expect(
      ids(filterPickerItems(items, { place: 'Hyde Park', from: '', to: '' }))
    ).toEqual(['2', '3'])
  })

  it('filters by an inclusive day range and drops undated photos', () => {
    expect(
      ids(
        filterPickerItems(items, {
          place: '',
          from: '2026-06-21',
          to: '2026-06-21'
        })
      )
    ).toEqual(['2'])
    expect(
      ids(filterPickerItems(items, { place: '', from: '2026-06-01', to: '' }))
    ).toEqual(['2', '4'])
    expect(
      ids(filterPickerItems(items, { place: '', from: '', to: '2026-05-31' }))
    ).toEqual(['1'])
  })

  it('combines place and dates', () => {
    expect(
      ids(
        filterPickerItems(items, {
          place: 'Hyde Park',
          from: '2026-06-01',
          to: '2026-06-30'
        })
      )
    ).toEqual(['2'])
  })
})

describe('species filter', () => {
  const species = (
    id: string,
    name: string | null,
    scientificName: string | null
  ) =>
    buildGalleryItem(id, {
      subject: {
        name,
        scientificName,
        category: 'bird',
        taxonKey: null,
        taxonPath: null
      }
    })
  const birds = [
    species('1', 'Kingfisher', 'Alcedo atthis'),
    species('2', null, 'Ardea cinerea'),
    species('3', 'Kingfisher', 'Alcedo atthis'),
    buildGalleryItem('4')
  ]

  it('lists each species once, sorted, by common else scientific name', () => {
    expect(getPickerSubjectNames(birds)).toEqual([
      'Ardea cinerea',
      'Kingfisher'
    ])
  })

  it('filters by species and combines it with the other filters', () => {
    const ids = (found: GalleryItemEntity[]) =>
      found.map((item) => item.mediaId)

    expect(
      ids(
        filterPickerItems(birds, {
          species: 'Kingfisher',
          place: '',
          from: '',
          to: ''
        })
      )
    ).toEqual(['1', '3'])
    expect(
      ids(
        filterPickerItems(birds, {
          species: 'Ardea cinerea',
          place: 'Hyde Park',
          from: '',
          to: ''
        })
      )
    ).toEqual([])
  })
})
