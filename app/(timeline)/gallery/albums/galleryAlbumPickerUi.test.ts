/** @vitest-environment jsdom */
import {
  filterPickerItems,
  getPickerBadges,
  getPickerCaption,
  getPickerPlaceNames,
  getPickerSubjectNames,
  scrollToResultsStart
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

  it('matches an undated photo by uploadedAt and never matches a photo with neither date', () => {
    const list = [
      buildGalleryItem('1', {
        takenAt: null,
        uploadedAt: '2026-07-15T12:00:00Z'
      }),
      buildGalleryItem('2', { takenAt: null, uploadedAt: null }),
      buildGalleryItem('3', {
        takenAt: '2026-07-10T12:00:00Z',
        uploadedAt: '2026-07-20T12:00:00Z'
      })
    ]
    expect(
      ids(
        filterPickerItems(list, {
          place: '',
          from: '2026-07-14',
          to: '2026-07-16'
        })
      )
    ).toEqual(['1'])
    expect(
      ids(
        filterPickerItems(list, {
          place: '',
          from: '2026-01-01',
          to: '2026-12-31'
        })
      )
    ).toEqual(['1', '3'])
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

describe('getPickerCaption', () => {
  it('returns species and date', () => {
    const item = buildGalleryItem('1', {
      subject: { name: 'Common kingfisher' } as never,
      takenAt: '2026-09-12T10:00:00Z'
    })
    expect(getPickerCaption(item)).toBe('Common kingfisher · 12 Sep 2026')
  })

  it('returns date only without a species', () => {
    const item = buildGalleryItem('1', {
      subject: null,
      takenAt: '2026-09-12T10:00:00Z'
    })
    expect(getPickerCaption(item)).toBe('12 Sep 2026')
  })

  it('falls back to uploadedAt when takenAt is missing', () => {
    const item = buildGalleryItem('1', {
      subject: { name: 'Common kingfisher' } as never,
      takenAt: null,
      uploadedAt: '2026-09-12T10:00:00Z'
    })
    expect(getPickerCaption(item)).toBe(
      'Common kingfisher · Uploaded 12 Sep 2026'
    )
  })

  it('returns Uploaded date alone for dateless photo without a species', () => {
    const item = buildGalleryItem('1', {
      subject: null,
      takenAt: null,
      uploadedAt: '2026-09-12T10:00:00Z'
    })
    expect(getPickerCaption(item)).toBe('Uploaded 12 Sep 2026')
  })

  it('returns empty string when there is no species and no dates', () => {
    const item = buildGalleryItem('1', {
      subject: null,
      takenAt: null,
      uploadedAt: null
    })
    expect(getPickerCaption(item)).toBe('')
  })
})

describe('getPickerBadges', () => {
  it('returns "not in gallery" when inGallery is false', () => {
    const item = buildGalleryItem('1', { inGallery: false })
    expect(getPickerBadges(item)).toEqual(['not in gallery'])
  })

  it('returns "in 1 album" when albumCount is 1', () => {
    const item = buildGalleryItem('1', { albumCount: 1 })
    expect(getPickerBadges(item)).toEqual(['in 1 album'])
  })

  it('returns "in 3 albums" when albumCount is 3', () => {
    const item = buildGalleryItem('1', { albumCount: 3 })
    expect(getPickerBadges(item)).toEqual(['in 3 albums'])
  })

  it('returns empty array when in gallery and not in any album', () => {
    const item = buildGalleryItem('1', { inGallery: true, albumCount: 0 })
    expect(getPickerBadges(item)).toEqual([])
  })
})

describe('scrollToResultsStart', () => {
  const setup = (top: number, scrollMarginTop = '0px') => {
    const element = document.createElement('div')
    element.scrollIntoView = vi.fn()
    element.getBoundingClientRect = () => ({ top }) as DOMRect
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      scrollMarginTop
    } as CSSStyleDeclaration)
    return element
  }
  afterEach(() => vi.restoreAllMocks())

  it('scrolls when the bar is above the viewport', () => {
    const element = setup(-40)
    scrollToResultsStart(element)
    expect(element.scrollIntoView).toHaveBeenCalled()
  })

  it('scrolls when the bar is under the sticky header', () => {
    const element = setup(40, '96px')
    scrollToResultsStart(element)
    expect(element.scrollIntoView).toHaveBeenCalled()
  })

  it('scrolls when the bar is clipped by the scroll container', () => {
    const scroller = document.createElement('div')
    const element = setup(150)
    scroller.append(element)
    scroller.getBoundingClientRect = () => ({ top: 200 }) as DOMRect
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (node) =>
        ({
          scrollMarginTop: '0px',
          overflowY: node === scroller ? 'auto' : 'visible'
        }) as unknown as CSSStyleDeclaration
    )
    scrollToResultsStart(element)
    expect(element.scrollIntoView).toHaveBeenCalled()
  })

  it('adds the margin to a scroller top, not the larger of the two', () => {
    const scroller = document.createElement('div')
    const element = setup(250, '96px')
    scroller.append(element)
    scroller.getBoundingClientRect = () => ({ top: 200 }) as DOMRect
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (node) =>
        ({
          scrollMarginTop: '96px',
          overflowY: node === scroller ? 'auto' : 'visible'
        }) as unknown as CSSStyleDeclaration
    )
    scrollToResultsStart(element)
    expect(element.scrollIntoView).toHaveBeenCalled()
  })

  it('clears the root scroll padding when the document scrolls', () => {
    const below = setup(40)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (node) =>
        ({
          scrollMarginTop: '0px',
          scrollPaddingTop: node === document.documentElement ? '64px' : ''
        }) as unknown as CSSStyleDeclaration
    )
    scrollToResultsStart(below)
    expect(below.scrollIntoView).toHaveBeenCalled()

    const clear = setup(80)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (node) =>
        ({
          scrollMarginTop: '0px',
          scrollPaddingTop: node === document.documentElement ? '64px' : ''
        }) as unknown as CSSStyleDeclaration
    )
    scrollToResultsStart(clear)
    expect(clear.scrollIntoView).not.toHaveBeenCalled()
  })

  it('does nothing when the bar is already clear of the header', () => {
    const element = setup(120, '96px')
    scrollToResultsStart(element)
    expect(element.scrollIntoView).not.toHaveBeenCalled()
  })
})
