import { describe, expect, it } from 'vitest'

import {
  EMPTY_GALLERY_FILTERS,
  clearGalleryFilters,
  countActiveFilters,
  getDateRange,
  setGalleryFilter,
  toGalleryMediaQuery
} from '@/lib/components/gallery/filters/galleryMediaFilterState'
import { withTimeZone } from '@/lib/testing/withTimeZone'
import { GALLERY_FILTER_NONE } from '@/lib/types/database/gallery'

describe('gallery media filter state', () => {
  describe('setGalleryFilter and clearGalleryFilters', () => {
    it('moves a re-set key to the end of the order', () => {
      let state = setGalleryFilter(EMPTY_GALLERY_FILTERS, 'species', 'sci:a b')
      state = setGalleryFilter(state, 'place', 'Paris')
      state = setGalleryFilter(state, 'species', 'sci:c d')

      expect(state.order).toEqual(['place', 'species'])
      expect(state.species).toBe('sci:c d')
      expect(countActiveFilters(state)).toBe(2)
    })

    it.each([
      ['place', null],
      ['notInAlbum', false]
    ] as const)('removes %s from the order when cleared', (key, empty) => {
      let state = setGalleryFilter(EMPTY_GALLERY_FILTERS, 'species', 'k')
      state = setGalleryFilter(state, key, key === 'notInAlbum' ? true : 'x')
      state = setGalleryFilter(state, key, empty)

      expect(state.order).toEqual(['species'])
      expect(state[key]).toBe(empty)
    })

    it('does not change the state it is given', () => {
      setGalleryFilter(EMPTY_GALLERY_FILTERS, 'place', 'Paris')

      expect(EMPTY_GALLERY_FILTERS.order).toEqual([])
      expect(EMPTY_GALLERY_FILTERS.place).toBeNull()
    })

    it('clears every filter but keeps the sort', () => {
      let state = setGalleryFilter(EMPTY_GALLERY_FILTERS, 'place', 'Paris')
      state = setGalleryFilter(state, 'notInAlbum', true)
      state = { ...state, sort: 'uploaded' }

      expect(clearGalleryFilters(state)).toEqual({
        ...EMPTY_GALLERY_FILTERS,
        sort: 'uploaded'
      })
    })
  })

  describe('getDateRange', () => {
    const today = new Date('2026-10-24T12:00:00Z')

    it.each([
      [{ kind: 'this_month' }, '2026-10-01', '2026-10-31'],
      [{ kind: 'this_year' }, '2026-01-01', '2026-12-31'],
      [{ kind: 'year', year: 2024 }, '2024-01-01', '2024-12-31'],
      [{ kind: 'month', month: '2026-01' }, '2026-01-01', '2026-01-31'],
      [{ kind: 'month', month: '2026-04' }, '2026-04-01', '2026-04-30'],
      [{ kind: 'month', month: '2026-02' }, '2026-02-01', '2026-02-28'],
      [{ kind: 'month', month: '2024-02' }, '2024-02-01', '2024-02-29'],
      [{ kind: 'month', month: '2025-12' }, '2025-12-01', '2025-12-31']
    ] as const)('%j covers %s to %s', (date, takenFrom, takenTo) => {
      expect(getDateRange(date, today)).toEqual({ takenFrom, takenTo })
    })

    it.each([
      [{ from: '2026-03-01', to: '2026-03-09' }, '2026-03-01', '2026-03-09'],
      [{ from: '2026-03-01', to: '' }, '2026-03-01', undefined],
      [{ from: '', to: '2026-03-09' }, undefined, '2026-03-09']
    ])('custom %j keeps an open end open', (range, takenFrom, takenTo) => {
      const result = getDateRange({ kind: 'custom', ...range }, today)

      expect(result.takenFrom).toBe(takenFrom)
      expect(result.takenTo).toBe(takenTo)
      expect(Object.keys(result)).toHaveLength(
        [takenFrom, takenTo].filter(Boolean).length
      )
    })

    it('reads today in UTC, not in the local zone', async () => {
      // 2026-10-31 23:30 UTC is already November 1st in Kiritimati (UTC+14).
      const lateOctober = new Date('2026-10-31T23:30:00Z')

      await withTimeZone('Pacific/Kiritimati', () => {
        expect(getDateRange({ kind: 'this_month' }, lateOctober)).toEqual({
          takenFrom: '2026-10-01',
          takenTo: '2026-10-31'
        })
      })
    })

    it('ignores a custom range label', () => {
      const date = {
        kind: 'custom' as const,
        from: '2026-03-01',
        to: '2026-03-09',
        label: 'Album dates · 1–9 Mar 2026'
      }

      expect(getDateRange(date, today)).toEqual({
        takenFrom: '2026-03-01',
        takenTo: '2026-03-09'
      })
      expect(
        toGalleryMediaQuery({ ...EMPTY_GALLERY_FILTERS, date }, today)
      ).toEqual({
        sort: 'taken_desc',
        takenFrom: '2026-03-01',
        takenTo: '2026-03-09'
      })
    })
  })

  describe('toGalleryMediaQuery', () => {
    const today = new Date('2026-10-24T12:00:00Z')

    it('is only the sort for an empty state', () => {
      expect(toGalleryMediaQuery(EMPTY_GALLERY_FILTERS, today)).toEqual({
        sort: 'taken_desc'
      })
    })

    it('maps each filter and passes none through unchanged', () => {
      let state = setGalleryFilter(EMPTY_GALLERY_FILTERS, 'species', 'k')
      state = setGalleryFilter(state, 'place', GALLERY_FILTER_NONE)
      state = setGalleryFilter(state, 'activity', GALLERY_FILTER_NONE)
      state = setGalleryFilter(state, 'date', { kind: 'year', year: 2025 })

      expect(toGalleryMediaQuery(state, today)).toEqual({
        sort: 'taken_desc',
        subject: 'k',
        place: GALLERY_FILTER_NONE,
        activityId: GALLERY_FILTER_NONE,
        takenFrom: '2025-01-01',
        takenTo: '2025-12-31'
      })
    })

    it('ignores notInAlbum', () => {
      const state = setGalleryFilter(EMPTY_GALLERY_FILTERS, 'notInAlbum', true)

      expect(toGalleryMediaQuery(state, today)).toEqual({ sort: 'taken_desc' })
    })
  })
})
