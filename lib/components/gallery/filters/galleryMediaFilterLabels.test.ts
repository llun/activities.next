/** @vitest-environment node */
import { describe, expect, it } from 'vitest'

import type {
  GalleryActivityFacet,
  GalleryMediaFacetsResponse,
  GallerySpeciesFacet
} from '@/lib/services/gallery/galleryEntities'
import { withTimeZone } from '@/lib/testing/withTimeZone'
import { GALLERY_FILTER_NONE } from '@/lib/types/database/gallery'

import {
  formatActivitySubtitle,
  formatActivityTitle,
  formatDateFilterChipLabel,
  formatEmptyStateDescription,
  formatFilterActiveValue,
  formatMonthFacetLabel,
  formatPlaceLabel,
  formatRemoveFilterLabel,
  formatSpeciesLabel
} from './galleryMediaFilterLabels'
import { EMPTY_GALLERY_FILTERS } from './galleryMediaFilterState'

describe('galleryMediaFilterLabels', () => {
  describe('formatSpeciesLabel', () => {
    it.each([
      {
        description: 'prefers common name when facet has both names',
        facet: {
          key: 'sci:alcedo atthis',
          name: 'Common kingfisher',
          scientificName: 'Alcedo atthis',
          category: 'bird' as const,
          count: 5
        },
        key: 'sci:alcedo atthis',
        expected: 'Common kingfisher'
      },
      {
        description: 'falls back to scientific name when common name is null',
        facet: {
          key: 'sci:alcedo atthis',
          name: null,
          scientificName: 'Alcedo atthis',
          category: 'bird' as const,
          count: 3
        },
        key: 'sci:alcedo atthis',
        expected: 'Alcedo atthis'
      },
      {
        description:
          'falls back to stripped key when facet has neither name nor scientificName',
        facet: {
          key: 'sci:vulpes vulpes',
          name: null,
          scientificName: null,
          category: null,
          count: 1
        },
        key: 'sci:vulpes vulpes',
        expected: 'vulpes vulpes'
      },
      {
        description:
          'falls back to "Species" when facet has neither name nor scientificName and key is null',
        facet: {
          key: 'sci:unknown',
          name: null,
          scientificName: null,
          category: null,
          count: 1
        },
        key: null,
        expected: 'Species'
      },
      {
        description:
          'falls back to "Species" when facet has neither name nor scientificName and key is empty after strip',
        facet: {
          key: 'name:',
          name: null,
          scientificName: null,
          category: null,
          count: 1
        },
        key: 'name:',
        expected: 'Species'
      },
      {
        description: 'strips leading name: prefix when no facet is provided',
        facet: undefined,
        key: 'name:red fox',
        expected: 'red fox'
      },
      {
        description: 'strips leading sci: prefix when no facet is provided',
        facet: undefined,
        key: 'sci:vulpes vulpes',
        expected: 'vulpes vulpes'
      },
      {
        description: 'leaves key untouched when no prefix is present',
        facet: undefined,
        key: 'pine marten',
        expected: 'pine marten'
      },
      {
        description: 'returns "Species" when key is empty after strip',
        facet: undefined,
        key: 'name:',
        expected: 'Species'
      },
      {
        description: 'returns "Species" when key is empty string',
        facet: undefined,
        key: '',
        expected: 'Species'
      },
      {
        description:
          'returns "Species" when key is null and no facet is provided',
        facet: undefined,
        key: null,
        expected: 'Species'
      }
    ])(
      '$description',
      ({
        facet,
        key,
        expected
      }: {
        facet: GallerySpeciesFacet | undefined
        key: string | null
        expected: string
      }) => {
        expect(formatSpeciesLabel(facet, key)).toBe(expected)
      }
    )
  })

  describe('formatPlaceLabel', () => {
    it.each([
      {
        description: 'returns "No place" for GALLERY_FILTER_NONE ("none")',
        place: GALLERY_FILTER_NONE,
        expected: 'No place'
      },
      {
        description: 'returns place name when non-empty string',
        place: 'Lake Bled, Slovenia',
        expected: 'Lake Bled, Slovenia'
      },
      {
        description: 'returns place name for single word place',
        place: 'London',
        expected: 'London'
      },
      {
        description: 'returns "Any place" for null',
        place: null,
        expected: 'Any place'
      },
      {
        description: 'returns "Any place" for undefined',
        place: undefined,
        expected: 'Any place'
      },
      {
        description: 'returns "Any place" for empty string',
        place: '',
        expected: 'Any place'
      },
      {
        description: 'returns "Any place" for whitespace-only string',
        place: '   ',
        expected: 'Any place'
      }
    ])('$description', ({ place, expected }) => {
      expect(formatPlaceLabel(place)).toBe(expected)
    })
  })

  describe('formatMonthFacetLabel', () => {
    it.each([
      {
        monthStr: '2025-10',
        expected: 'October 2025'
      },
      {
        monthStr: '2024-01',
        expected: 'January 2024'
      },
      {
        monthStr: '2023-12',
        expected: 'December 2023'
      },
      {
        monthStr: '2026-07',
        expected: 'July 2026'
      },
      {
        monthStr: 'invalid-string',
        expected: 'invalid-string'
      }
    ])('formats $monthStr as $expected', ({ monthStr, expected }) => {
      expect(formatMonthFacetLabel(monthStr)).toBe(expected)
    })

    it('formats month facet consistently across different time zones', () => {
      withTimeZone('Pacific/Auckland', () => {
        expect(formatMonthFacetLabel('2025-10')).toBe('October 2025')
      })
      withTimeZone('America/New_York', () => {
        expect(formatMonthFacetLabel('2025-10')).toBe('October 2025')
      })
    })
  })

  describe('formatDateFilterChipLabel', () => {
    it.each([
      {
        description: 'returns "Any time" when null',
        date: null,
        expected: 'Any time'
      },
      {
        description: 'returns "Any time" when undefined',
        date: undefined,
        expected: 'Any time'
      },
      {
        description: 'formats this_month',
        date: { kind: 'this_month' as const },
        expected: 'This month'
      },
      {
        description: 'formats this_year',
        date: { kind: 'this_year' as const },
        expected: 'This year'
      },
      {
        description: 'formats year',
        date: { kind: 'year' as const, year: 2025 },
        expected: '2025'
      },
      {
        description: 'formats month (short month and year)',
        date: { kind: 'month' as const, month: '2025-10' },
        expected: 'Oct 2025'
      },
      {
        description: 'formats custom with same date',
        date: { kind: 'custom' as const, from: '2025-10-03', to: '2025-10-03' },
        expected: '3 Oct 2025'
      },
      {
        description: 'formats custom with same year (en-dash)',
        date: { kind: 'custom' as const, from: '2025-10-03', to: '2025-10-09' },
        expected: '3 Oct \u2013 9 Oct 2025'
      },
      {
        description: 'formats custom with same year across different months',
        date: { kind: 'custom' as const, from: '2025-05-15', to: '2025-06-20' },
        expected: '15 May \u2013 20 Jun 2025'
      },
      {
        description: 'formats custom across different years (en-dash)',
        date: { kind: 'custom' as const, from: '2024-12-31', to: '2025-01-02' },
        expected: '31 Dec 2024 \u2013 2 Jan 2025'
      },
      {
        description: 'formats custom with only from date',
        date: { kind: 'custom' as const, from: '2025-10-03', to: '' },
        expected: 'From 3 Oct 2025'
      },
      {
        description: 'formats custom with only to date',
        date: { kind: 'custom' as const, from: '', to: '2025-10-09' },
        expected: 'Until 9 Oct 2025'
      },
      {
        description: 'formats custom with neither from nor to as "Any time"',
        date: { kind: 'custom' as const, from: '', to: '' },
        expected: 'Any time'
      }
    ])('$description', ({ date, expected }) => {
      expect(formatDateFilterChipLabel(date)).toBe(expected)
    })

    it('formats date chip consistently across different time zones', () => {
      const customFilter = {
        kind: 'custom' as const,
        from: '2025-10-03',
        to: '2025-10-09'
      }
      withTimeZone('Pacific/Auckland', () => {
        expect(formatDateFilterChipLabel(customFilter)).toBe(
          '3 Oct \u2013 9 Oct 2025'
        )
      })
      withTimeZone('America/New_York', () => {
        expect(formatDateFilterChipLabel(customFilter)).toBe(
          '3 Oct \u2013 9 Oct 2025'
        )
      })
    })

    it('returns the label of a custom range when one is set', () => {
      expect(
        formatDateFilterChipLabel({
          kind: 'custom',
          from: '2025-10-04',
          to: '2025-10-12',
          label: 'Album dates · 4–12 Oct 2025'
        })
      ).toBe('Album dates · 4–12 Oct 2025')
    })

    it('computes a custom range without a label as before', () => {
      expect(
        formatDateFilterChipLabel({
          kind: 'custom',
          from: '2025-10-04',
          to: '2025-10-12',
          label: undefined
        })
      ).toBe('4 Oct \u2013 12 Oct 2025')
    })
  })

  describe('formatActivityTitle', () => {
    it.each([
      {
        description:
          'returns "Not from an activity" when activityId is GALLERY_FILTER_NONE',
        facet: undefined,
        activityId: GALLERY_FILTER_NONE,
        expected: 'Not from an activity'
      },
      {
        description:
          'returns "Not from an activity" when activityId is GALLERY_FILTER_NONE even if facet passed',
        facet: {
          id: 'none',
          activityType: 'run',
          startTime: null,
          distanceMeters: 5000,
          placeName: null,
          count: 1
        },
        activityId: GALLERY_FILTER_NONE,
        expected: 'Not from an activity'
      },
      {
        description: 'formats facet with known sport key and distance >= 10km',
        facet: {
          id: 'act-1',
          activityType: 'Run',
          startTime: '2025-10-05T08:00:00Z',
          distanceMeters: 21100,
          placeName: 'Richmond Park',
          count: 10
        },
        activityId: 'act-1',
        expected: 'Run · 21.1 km'
      },
      {
        description:
          'formats facet with known sport key and distance < 10km (2 decimal places)',
        facet: {
          id: 'act-2',
          activityType: 'run',
          startTime: '2025-10-05T08:00:00Z',
          distanceMeters: 5234,
          placeName: null,
          count: 2
        },
        activityId: 'act-2',
        expected: 'Run · 5.23 km'
      },
      {
        description: 'formats facet with known sport key and no distance',
        facet: {
          id: 'act-3',
          activityType: 'ride',
          startTime: null,
          distanceMeters: null,
          placeName: null,
          count: 1
        },
        activityId: 'act-3',
        expected: 'Ride'
      },
      {
        description: 'formats facet with gravel_ride mapping to Gravel ride',
        facet: {
          id: 'act-4',
          activityType: 'GravelRide',
          startTime: null,
          distanceMeters: 45000,
          placeName: null,
          count: 4
        },
        activityId: 'act-4',
        expected: 'Gravel ride · 45.0 km'
      },
      {
        description:
          'formats facet with unmodelled sport key using formatActivityTypeLabel',
        facet: {
          id: 'act-5',
          activityType: 'badminton',
          startTime: null,
          distanceMeters: null,
          placeName: null,
          count: 1
        },
        activityId: 'act-5',
        expected: 'Badminton'
      },
      {
        description: 'formats facet with null activityType as "Activity"',
        facet: {
          id: 'act-6',
          activityType: null,
          startTime: null,
          distanceMeters: null,
          placeName: null,
          count: 1
        },
        activityId: 'act-6',
        expected: 'Activity'
      },
      {
        description:
          'formats facet with null activityType but distance present',
        facet: {
          id: 'act-7',
          activityType: null,
          startTime: null,
          distanceMeters: 10000,
          placeName: null,
          count: 1
        },
        activityId: 'act-7',
        expected: 'Activity · 10.0 km'
      },
      {
        description: 'formats facet with distance <= 0 without distance suffix',
        facet: {
          id: 'act-8',
          activityType: 'run',
          startTime: null,
          distanceMeters: 0,
          placeName: null,
          count: 1
        },
        activityId: 'act-8',
        expected: 'Run'
      },
      {
        description:
          'returns "Activity" when no facet but non-empty activityId provided',
        facet: undefined,
        activityId: 'act-999',
        expected: 'Activity'
      },
      {
        description:
          'returns "Any activity" when no facet and activityId is null',
        facet: undefined,
        activityId: null,
        expected: 'Any activity'
      },
      {
        description:
          'returns "Any activity" when no facet and activityId is empty string',
        facet: undefined,
        activityId: '',
        expected: 'Any activity'
      }
    ])(
      '$description',
      ({
        facet,
        activityId,
        expected
      }: {
        facet: GalleryActivityFacet | undefined
        activityId: string | null
        expected: string
      }) => {
        expect(formatActivityTitle(facet, activityId)).toBe(expected)
      }
    )

    it('accepts a day activity with only the type and the distance', () => {
      expect(
        formatActivityTitle(
          { activityType: 'ride', distanceMeters: 64200 },
          'act-day'
        )
      ).toBe('Ride · 64.2 km')
    })
  })

  describe('formatActivitySubtitle', () => {
    it.each([
      {
        description: 'formats both date and place joined by middle dot',
        facet: {
          id: 'act-1',
          activityType: 'run',
          startTime: '2025-10-05T08:00:00Z',
          distanceMeters: 10000,
          placeName: 'Richmond Park',
          count: 1
        },
        expected: 'Sun 5 Oct 2025 · Richmond Park'
      },
      {
        description: 'formats date only when placeName is null',
        facet: {
          id: 'act-2',
          activityType: 'ride',
          startTime: '2025-10-05T08:00:00Z',
          distanceMeters: null,
          placeName: null,
          count: 1
        },
        expected: 'Sun 5 Oct 2025'
      },
      {
        description: 'formats date only when placeName is whitespace',
        facet: {
          id: 'act-3',
          activityType: 'ride',
          startTime: '2025-10-05T08:00:00Z',
          distanceMeters: null,
          placeName: '   ',
          count: 1
        },
        expected: 'Sun 5 Oct 2025'
      },
      {
        description: 'formats place only when startTime is null',
        facet: {
          id: 'act-4',
          activityType: 'walk',
          startTime: null,
          distanceMeters: null,
          placeName: 'Richmond Park',
          count: 1
        },
        expected: 'Richmond Park'
      },
      {
        description: 'returns null when both startTime and placeName are null',
        facet: {
          id: 'act-5',
          activityType: 'walk',
          startTime: null,
          distanceMeters: null,
          placeName: null,
          count: 1
        },
        expected: null
      },
      {
        description:
          'returns null when startTime is invalid date string and place is null',
        facet: {
          id: 'act-6',
          activityType: 'walk',
          startTime: 'not-a-date',
          distanceMeters: null,
          placeName: null,
          count: 1
        },
        expected: null
      },
      {
        description:
          'returns place when startTime is invalid date string and place is present',
        facet: {
          id: 'act-7',
          activityType: 'walk',
          startTime: 'not-a-date',
          distanceMeters: null,
          placeName: 'Richmond Park',
          count: 1
        },
        expected: 'Richmond Park'
      }
    ])(
      '$description',
      ({
        facet,
        expected
      }: {
        facet: GalleryActivityFacet
        expected: string | null
      }) => {
        expect(formatActivitySubtitle(facet)).toBe(expected)
      }
    )

    it('formats activity subtitle consistently across different time zones', () => {
      const facet: GalleryActivityFacet = {
        id: 'act-tz',
        activityType: 'run',
        startTime: '2025-10-05T23:30:00Z',
        distanceMeters: 5000,
        placeName: 'Richmond Park',
        count: 1
      }
      withTimeZone('Pacific/Auckland', () => {
        expect(formatActivitySubtitle(facet)).toBe(
          'Sun 5 Oct 2025 · Richmond Park'
        )
      })
      withTimeZone('America/New_York', () => {
        expect(formatActivitySubtitle(facet)).toBe(
          'Sun 5 Oct 2025 · Richmond Park'
        )
      })
    })
  })

  describe('formatFilterActiveValue', () => {
    const facets: GalleryMediaFacetsResponse = {
      total: 42,
      species: [
        {
          key: 'sci:alcedo atthis',
          name: 'Common kingfisher',
          scientificName: 'Alcedo atthis',
          category: 'bird',
          count: 12
        }
      ],
      places: [{ name: 'Lake Bled, Slovenia', count: 8 }],
      noPlaceCount: 2,
      months: [{ month: '2024-05', count: 10 }],
      activities: [
        {
          id: 'act-1',
          activityType: 'run',
          startTime: '2025-10-05T08:00:00Z',
          distanceMeters: 21100,
          placeName: 'Richmond Park',
          count: 5
        }
      ],
      notFromActivityCount: 15
    }

    it.each([
      {
        description: 'formats species using matching facet',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          species: 'sci:alcedo atthis'
        },
        key: 'species' as const,
        facets,
        expected: 'Common kingfisher'
      },
      {
        description:
          'formats species when no facet matches by stripping prefix',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          species: 'name:red fox'
        },
        key: 'species' as const,
        facets: null,
        expected: 'red fox'
      },
      {
        description: 'formats place when non-empty string',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          place: 'Lake Bled, Slovenia'
        },
        key: 'place' as const,
        facets,
        expected: 'Lake Bled, Slovenia'
      },
      {
        description: 'formats place when GALLERY_FILTER_NONE',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          place: GALLERY_FILTER_NONE
        },
        key: 'place' as const,
        facets,
        expected: 'No place'
      },
      {
        description: 'formats date filter',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          date: { kind: 'year' as const, year: 2024 }
        },
        key: 'date' as const,
        facets,
        expected: '2024'
      },
      {
        description: 'formats activity using matching facet',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          activity: 'act-1'
        },
        key: 'activity' as const,
        facets,
        expected: 'Run · 21.1 km'
      },
      {
        description: 'formats activity when GALLERY_FILTER_NONE',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          activity: GALLERY_FILTER_NONE
        },
        key: 'activity' as const,
        facets,
        expected: 'Not from an activity'
      },
      {
        description: 'formats notInAlbum key',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          notInAlbum: true
        },
        key: 'notInAlbum' as const,
        facets,
        expected: 'Not in an album'
      }
    ])('$description', ({ filters, key, facets: testFacets, expected }) => {
      expect(formatFilterActiveValue(filters, key, testFacets)).toBe(expected)
    })
  })

  describe('formatEmptyStateDescription', () => {
    const facets: GalleryMediaFacetsResponse = {
      total: 100,
      species: [
        {
          key: 'sci:alcedo atthis',
          name: 'Common kingfisher',
          scientificName: 'Alcedo atthis',
          category: 'bird',
          count: 5
        }
      ],
      places: [{ name: 'Lake Bled, Slovenia', count: 12 }],
      noPlaceCount: 0,
      months: [],
      activities: [],
      notFromActivityCount: 0
    }

    it.each([
      {
        description: 'returns empty string when no filters are in order',
        filters: EMPTY_GALLERY_FILTERS,
        expected: ''
      },
      {
        description: 'joins active values in order by middle dot',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          species: 'sci:alcedo atthis',
          place: 'Lake Bled, Slovenia',
          date: { kind: 'year' as const, year: 2024 },
          order: ['species' as const, 'place' as const, 'date' as const]
        },
        expected: 'Common kingfisher · Lake Bled, Slovenia · 2024'
      },
      {
        description:
          'formats filters including notInAlbum and No place in given order',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          notInAlbum: true,
          place: GALLERY_FILTER_NONE,
          order: ['notInAlbum' as const, 'place' as const]
        },
        expected: 'Not in an album · No place'
      }
    ])('$description', ({ filters, expected }) => {
      expect(formatEmptyStateDescription(filters, facets)).toBe(expected)
    })
  })

  describe('formatRemoveFilterLabel', () => {
    const facets: GalleryMediaFacetsResponse = {
      total: 50,
      species: [
        {
          key: 'sci:alcedo atthis',
          name: 'Common kingfisher',
          scientificName: 'Alcedo atthis',
          category: 'bird',
          count: 5
        }
      ],
      places: [{ name: 'Lake Bled, Slovenia', count: 5 }],
      noPlaceCount: 1,
      months: [],
      activities: [
        {
          id: 'act-1',
          activityType: 'run',
          startTime: null,
          distanceMeters: 21100,
          placeName: null,
          count: 1
        }
      ],
      notFromActivityCount: 10
    }

    it.each([
      {
        description: 'returns null when order is empty',
        filters: EMPTY_GALLERY_FILTERS,
        expected: null
      },
      {
        description: 'formats Remove for last filter: year',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          date: { kind: 'year' as const, year: 2024 },
          order: ['date' as const]
        },
        expected: 'Remove 2024'
      },
      {
        description: 'formats Remove for last filter: species',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          date: { kind: 'year' as const, year: 2024 },
          species: 'sci:alcedo atthis',
          order: ['date' as const, 'species' as const]
        },
        expected: 'Remove Common kingfisher'
      },
      {
        description: 'formats Remove for last filter: place',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          place: 'Lake Bled, Slovenia',
          order: ['place' as const]
        },
        expected: 'Remove Lake Bled, Slovenia'
      },
      {
        description: 'formats Remove for last filter: No place',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          place: GALLERY_FILTER_NONE,
          order: ['place' as const]
        },
        expected: 'Remove No place'
      },
      {
        description: 'formats Remove for last filter: Not in an album',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          notInAlbum: true,
          order: ['notInAlbum' as const]
        },
        expected: 'Remove Not in an album'
      },
      {
        description: 'formats Remove for last filter: activity',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          activity: 'act-1',
          order: ['activity' as const]
        },
        expected: 'Remove Run · 21.1 km'
      },
      {
        description: 'formats Remove for last filter: activity none',
        filters: {
          ...EMPTY_GALLERY_FILTERS,
          activity: GALLERY_FILTER_NONE,
          order: ['activity' as const]
        },
        expected: 'Remove Not from an activity'
      }
    ])('$description', ({ filters, expected }) => {
      expect(formatRemoveFilterLabel(filters, facets)).toBe(expected)
    })
  })
})
