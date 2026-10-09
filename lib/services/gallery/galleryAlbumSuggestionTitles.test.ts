import {
  buildIndexRow,
  buildPlacedRow
} from '@/lib/services/gallery/__fixtures__/galleryIndexRow'
import {
  formatSuggestionDays,
  formatSuggestionMonths,
  getActivityDayTitle,
  getSafePlaceName,
  getSpeciesTitle,
  getTripTitle
} from '@/lib/services/gallery/galleryAlbumSuggestionTitles'
import { withTimeZone } from '@/lib/testing/withTimeZone'
import { GalleryHiddenLocation } from '@/lib/types/database/gallery'

const SETTINGS = { hiddenLocations: [], hideThreatenedPlaces: true }
const FIRST = Date.UTC(2026, 8, 12, 6)
const LAST = Date.UTC(2026, 8, 19, 18)

const cleared = {
  subjectLookupStatus: 'resolved',
  subjectIucnCategory: 'LC'
} as const
const kingfisher = {
  subjectName: 'Kingfisher',
  subjectScientificName: 'Alcedo atthis',
  subjectCategory: 'bird'
} as const

describe('formatSuggestionDays', () => {
  it.each([
    {
      description: 'inside a month',
      from: Date.UTC(2026, 8, 12),
      to: Date.UTC(2026, 8, 19),
      expected: '12–19 Sep 2026'
    },
    {
      description: 'across months',
      from: Date.UTC(2026, 7, 28),
      to: Date.UTC(2026, 8, 3),
      expected: '28 Aug–3 Sep 2026'
    },
    {
      description: 'across years',
      from: Date.UTC(2025, 11, 28),
      to: Date.UTC(2026, 0, 3),
      expected: '28 Dec 2025–3 Jan 2026'
    },
    {
      description: 'one day',
      from: Date.UTC(2026, 8, 12, 1),
      to: Date.UTC(2026, 8, 12, 23),
      expected: '12 Sep 2026'
    },
    {
      description: 'reversed bounds',
      from: Date.UTC(2026, 8, 19),
      to: Date.UTC(2026, 8, 12),
      expected: '12–19 Sep 2026'
    }
  ])('formats $description', ({ from, to, expected }) => {
    expect(formatSuggestionDays(from, to)).toBe(expected)
  })

  it('does not move a date when the machine is in another time zone', async () => {
    for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles']) {
      await withTimeZone(zone, () => {
        // 23:30 UTC on the 12th is the 13th in Kiritimati and the 12th in LA.
        expect(
          formatSuggestionDays(
            Date.UTC(2026, 8, 12, 23, 30),
            Date.UTC(2026, 8, 12, 23, 30)
          )
        ).toBe('12 Sep 2026')
      })
    }
  })
})

describe('formatSuggestionMonths', () => {
  it.each([
    {
      description: 'one month',
      from: Date.UTC(2026, 8, 12),
      to: Date.UTC(2026, 8, 19),
      expected: 'September 2026'
    },
    {
      description: 'two months',
      from: Date.UTC(2026, 7, 30),
      to: Date.UTC(2026, 8, 2),
      expected: 'Aug–Sep 2026'
    },
    {
      description: 'two years',
      from: Date.UTC(2025, 11, 30),
      to: Date.UTC(2026, 0, 2),
      expected: 'Dec 2025–Jan 2026'
    }
  ])('formats $description', ({ from, to, expected }) => {
    expect(formatSuggestionMonths(from, to)).toBe(expected)
  })
})

describe('getTripTitle', () => {
  const rows = (...names: string[]) =>
    names.map((name, index) => buildPlacedRow(index + 1, name))

  it('names the place when every photo shows that one place publicly', () => {
    expect(
      getTripTitle(rows('Kruger', 'Kruger', 'Kruger'), SETTINGS, FIRST, LAST)
    ).toBe('Kruger, September 2026')
  })

  it('falls back to dates when the photos show more than one place, whatever the row order', () => {
    // Every name is public for its own photo, but a trip through two places
    // is not named after one of them.
    for (const names of [
      ['Kruger', 'Kruger', 'Satara'],
      ['Satara', 'Kruger', 'Kruger'],
      ['Satara', 'Kruger'],
      ['Kruger', 'Satara']
    ]) {
      expect(getTripTitle(rows(...names), SETTINGS, FIRST, LAST)).toBe(
        'Trip, 12–19 Sep 2026'
      )
    }
  })

  it('falls back to dates when there are no photos a visitor can see', () => {
    expect(getTripTitle([], SETTINGS, FIRST, LAST)).toBe('Trip, 12–19 Sep 2026')
  })

  it('falls back to dates when no photo has a place', () => {
    expect(
      getTripTitle([buildIndexRow(1), buildIndexRow(2)], SETTINGS, FIRST, LAST)
    ).toBe('Trip, 12–19 Sep 2026')
  })

  it('falls back to dates when only some photos have a place', () => {
    expect(
      getTripTitle(
        [buildPlacedRow(1, 'Kruger'), buildIndexRow(2)],
        SETTINGS,
        FIRST,
        LAST
      )
    ).toBe('Trip, 12–19 Sep 2026')
  })

  it('never names a place of a threatened species, nor one a lookup has not cleared', () => {
    const threatened = {
      ...kingfisher,
      subjectLookupStatus: 'resolved',
      subjectIucnCategory: 'CR'
    } as const
    const failed = { ...kingfisher, subjectLookupStatus: 'failed' } as const
    const pending = { ...kingfisher, subjectLookupStatus: 'pending' } as const

    for (const subject of [threatened, failed, pending]) {
      const title = getTripTitle(
        [
          buildPlacedRow(1, 'Kruger', cleared),
          buildPlacedRow(2, 'Hemis Secret Valley', subject)
        ],
        SETTINGS,
        FIRST,
        LAST
      )
      expect(title).toBe('Trip, 12–19 Sep 2026')
      expect(title).not.toContain('Hemis')
      expect(title).not.toContain('Kruger')
    }
  })

  it('names the place of a threatened species when the owner turned the protection off', () => {
    expect(
      getTripTitle(
        [
          buildPlacedRow(1, 'Hemis', {
            ...kingfisher,
            subjectLookupStatus: 'resolved',
            subjectIucnCategory: 'CR'
          })
        ],
        { hiddenLocations: [], hideThreatenedPlaces: false },
        FIRST,
        LAST
      )
    ).toBe('Hemis, September 2026')
  })

  it('never names a place at hidden precision or inside a hidden location', () => {
    const home: GalleryHiddenLocation = {
      latitude: 10.5,
      longitude: 20.5,
      hideRadiusMeters: 500
    }
    expect(
      getTripTitle(
        [
          buildPlacedRow(1, 'Kruger'),
          buildPlacedRow(2, 'Secret hide', { placePrecision: 'hidden' })
        ],
        SETTINGS,
        FIRST,
        LAST
      )
    ).toBe('Trip, 12–19 Sep 2026')
    expect(
      getTripTitle(
        [buildPlacedRow(1, 'Next to home')],
        { hiddenLocations: [home], hideThreatenedPlaces: true },
        FIRST,
        LAST
      )
    ).toBe('Trip, 12–19 Sep 2026')
  })

  it('does not use a geocoder name the owner never chose to show', () => {
    expect(
      getTripTitle(
        [
          buildIndexRow(1, {
            placeName: 'Pak Chong',
            placePrecision: null,
            placeNameSource: 'geocoder'
          })
        ],
        SETTINGS,
        FIRST,
        LAST
      )
    ).toBe('Trip, 12–19 Sep 2026')
  })

  it('names a country-precision photo by its country, not its geocoded town', () => {
    const rows = [
      buildIndexRow(1, {
        placeName: 'Pak Chong, Thailand',
        placePrecision: 'country',
        placeCountryCode: 'TH',
        placeNameSource: 'geocoder'
      })
    ]
    expect(getSafePlaceName(rows, SETTINGS)).toBe('Thailand')
  })

  it('keeps the title within the album title limit', () => {
    const long = 'A very long place name '.repeat(20)
    const title = getTripTitle(rows(long), SETTINGS, FIRST, LAST)

    expect(title.length).toBeLessThanOrEqual(120)
    expect(title.endsWith(', September 2026')).toBeTrue()
  })

  it('has no safe place for an empty cluster', () => {
    expect(getSafePlaceName([], SETTINGS)).toBeNull()
  })
})

describe('species and activity day titles', () => {
  it('uses only the species name', () => {
    expect(getSpeciesTitle('  Common kingfisher ')).toBe('Common kingfisher')
  })

  it('names an activity day by its date alone', () => {
    expect(getActivityDayTitle(Date.UTC(2026, 8, 27, 7))).toBe(
      'Activity day, 27 Sep 2026'
    )
  })
})
