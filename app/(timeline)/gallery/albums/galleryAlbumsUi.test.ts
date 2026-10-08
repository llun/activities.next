import {
  formatAlbumDateRange,
  getAlbumCardMeta,
  getAlbumFactsParts,
  getAlbumShareUrl,
  getHiddenPlacesLabel
} from '@/app/(timeline)/gallery/albums/galleryAlbumsUi'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'

describe('formatAlbumDateRange', () => {
  it.each([
    ['2026-09-12T10:00:00Z', '2026-09-19T08:00:00Z', '12 – 19 Sep 2026'],
    ['2026-09-12T10:00:00Z', '2026-09-12T18:00:00Z', '12 Sep 2026'],
    ['2026-08-28T10:00:00Z', '2026-09-03T08:00:00Z', '28 Aug – 3 Sep 2026'],
    [
      '2025-12-28T10:00:00Z',
      '2026-01-03T08:00:00Z',
      '28 Dec 2025 – 3 Jan 2026'
    ],
    ['2026-09-12T10:00:00Z', null, '12 Sep 2026'],
    [null, '2026-09-19T08:00:00Z', '19 Sep 2026'],
    [null, null, ''],
    ['not a date', null, '']
  ])('reads %s to %s as "%s"', (first, last, expected) => {
    expect(formatAlbumDateRange(first, last)).toBe(expected)
  })

  it('reads the day in UTC, whatever the zone', () => {
    expect(
      formatAlbumDateRange('2026-09-12T23:30:00Z', '2026-09-12T23:59:00Z')
    ).toBe('12 Sep 2026')
  })
})

describe('getAlbumCardMeta', () => {
  it('joins the count and the dates', () => {
    expect(getAlbumCardMeta(buildAlbumCard('a', { itemCount: 1 }))).toBe(
      '1 photo · 12 – 19 Sep 2026'
    )
  })

  it('leaves the dates out for an empty album', () => {
    expect(
      getAlbumCardMeta(
        buildAlbumCard('a', { itemCount: 0, firstAt: null, lastAt: null })
      )
    ).toBe('0 photos')
  })
})

describe('getAlbumFactsParts', () => {
  const facts = {
    photoCount: 12,
    speciesCount: 8,
    placeCount: 3,
    countryCount: 1,
    dayCount: 8,
    countryCodes: ['ZA'],
    countryName: 'South Africa',
    firstAt: null,
    lastAt: null
  }

  it('lists photos, species, places with countries, and days', () => {
    expect(getAlbumFactsParts(facts)).toEqual([
      '12 photos',
      '8 species',
      '3 places · 1 country',
      '8 days'
    ])
  })

  it('drops what is zero instead of showing 0', () => {
    expect(
      getAlbumFactsParts({
        ...facts,
        speciesCount: 0,
        placeCount: 0,
        countryCount: 0,
        dayCount: 0
      })
    ).toEqual(['12 photos'])
  })

  it('shows places without a country count when no country is known', () => {
    expect(
      getAlbumFactsParts({ ...facts, placeCount: 1, countryCount: 0 })
    ).toContain('1 place')
  })
})

describe('getHiddenPlacesLabel', () => {
  it('counts the places hidden', () => {
    expect(getHiddenPlacesLabel(1)).toBe('1 place hidden (threatened species)')
    expect(getHiddenPlacesLabel(4)).toBe('4 places hidden (threatened species)')
  })
})

describe('getAlbumShareUrl', () => {
  it('addresses the album under the profile', () => {
    expect(getAlbumShareUrl('https://example.com/@llun', 'a b')).toBe(
      'https://example.com/@llun/albums/a%20b'
    )
  })
})
