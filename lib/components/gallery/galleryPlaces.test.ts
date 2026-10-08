import type { GalleryMapPoint } from '@/lib/services/gallery/galleryEntities'

import {
  UNNAMED_PLACE,
  getPointBounds,
  groupPointsByPlace
} from './galleryPlaces'

const point = (overrides: Partial<GalleryMapPoint>): GalleryMapPoint => ({
  mediaId: 'm',
  statusId: 's',
  latitude: 0,
  longitude: 0,
  precision: 'exact',
  subjectName: null,
  placeName: null,
  countryCode: null,
  thumbnailUrl: null,
  takenAt: null,
  ...overrides
})

describe('groupPointsByPlace', () => {
  it('groups by trimmed place name, biggest first and ties by name', () => {
    const groups = groupPointsByPlace([
      point({ placeName: 'Zeta' }),
      point({ placeName: 'Alpha' }),
      point({ placeName: ' Big ' }),
      point({ placeName: 'Big' }),
      point({ placeName: '   ' }),
      point({ placeName: null })
    ])

    expect(groups.map((group) => [group.name, group.count])).toEqual([
      ['Big', 2],
      [UNNAMED_PLACE, 2],
      ['Alpha', 1],
      ['Zeta', 1]
    ])
  })

  it('keeps at most three distinct thumbnails, counts subjects and finds the last date', () => {
    const [group] = groupPointsByPlace([
      point({
        placeName: 'P',
        thumbnailUrl: 'a',
        subjectName: 'Kingfisher',
        takenAt: '2026-01-02T00:00:00.000Z'
      }),
      point({ placeName: 'P', thumbnailUrl: 'a', subjectName: 'Kingfisher' }),
      point({
        placeName: 'P',
        thumbnailUrl: 'b',
        subjectName: 'Roller',
        takenAt: '2026-03-04T00:00:00.000Z'
      }),
      point({ placeName: 'P', thumbnailUrl: 'c', takenAt: 'not a date' }),
      point({ placeName: 'P', thumbnailUrl: 'd' })
    ])

    expect(group.thumbnails).toEqual(['a', 'b', 'c'])
    expect(group.subjectCount).toBe(2)
    expect(group.lastTakenAt).toBe('2026-03-04T00:00:00.000Z')
    expect(group.count).toBe(5)
  })
})

describe('getPointBounds', () => {
  it('is null without points and spans the extremes otherwise', () => {
    expect(getPointBounds([])).toBeNull()
    expect(
      getPointBounds([
        point({ latitude: 1, longitude: -5 }),
        point({ latitude: -3, longitude: 9 }),
        point({ latitude: 2, longitude: 0 })
      ])
    ).toEqual({ minLat: -3, maxLat: 2, minLng: -5, maxLng: 9 })
  })
})
