import type { GetGalleryMediaOptions } from '@/lib/client/galleryMedia'
import type { GalleryMediaSort } from '@/lib/types/database/gallery'

// The filter state of the gallery photo pickers, as pure data (no 'use client':
// hosts and tests import it freely). `place` and `activity` hold
// GALLERY_FILTER_NONE for "photos with none".

export type GalleryDateFilter =
  | { kind: 'this_month' }
  | { kind: 'this_year' }
  | { kind: 'year'; year: number }
  // 'YYYY-MM'
  | { kind: 'month'; month: string }
  // YYYY-MM-DD, '' = open end
  | { kind: 'custom'; from: string; to: string }

export type GalleryFilterKey =
  'species' | 'place' | 'date' | 'activity' | 'notInAlbum'

export interface GalleryMediaFilterState {
  // toSubjectKey key
  species: string | null
  // Place name, or GALLERY_FILTER_NONE
  place: string | null
  date: GalleryDateFilter | null
  // Fitness file id, or GALLERY_FILTER_NONE
  activity: string | null
  // Picker only; the host maps it to show='not_in_album'
  notInAlbum: boolean
  sort: GalleryMediaSort
  // Active keys in the order they were turned on ("Remove <last>")
  order: GalleryFilterKey[]
}

export const EMPTY_GALLERY_FILTERS: GalleryMediaFilterState = {
  species: null,
  place: null,
  date: null,
  activity: null,
  notInAlbum: false,
  sort: 'taken_desc',
  order: []
}

/** Sets a filter (the key moves to the end of `order`); null or false removes it. */
export const setGalleryFilter = <K extends GalleryFilterKey>(
  state: GalleryMediaFilterState,
  key: K,
  value: GalleryMediaFilterState[K]
): GalleryMediaFilterState => {
  const order = state.order.filter((entry) => entry !== key)
  if (value !== null && value !== false) order.push(key)
  return { ...state, [key]: value, order }
}

/** Every filter off; the sort stays. */
export const clearGalleryFilters = (
  state: GalleryMediaFilterState
): GalleryMediaFilterState => ({ ...EMPTY_GALLERY_FILTERS, sort: state.sort })

export const countActiveFilters = (state: GalleryMediaFilterState): number =>
  state.order.length

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

const monthRange = (year: number, month: number) => {
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const prefix = `${pad(year, 4)}-${pad(month)}`
  return { takenFrom: `${prefix}-01`, takenTo: `${prefix}-${pad(lastDay)}` }
}

const yearRange = (year: number) => ({
  takenFrom: `${pad(year, 4)}-01-01`,
  takenTo: `${pad(year, 4)}-12-31`
})

/** The inclusive UTC day range a date filter covers; an open end is left out. */
export const getDateRange = (
  date: GalleryDateFilter,
  today: Date
): { takenFrom?: string; takenTo?: string } => {
  switch (date.kind) {
    case 'this_month':
      return monthRange(today.getUTCFullYear(), today.getUTCMonth() + 1)
    case 'this_year':
      return yearRange(today.getUTCFullYear())
    case 'year':
      return yearRange(date.year)
    case 'month': {
      const [year, month] = date.month.split('-').map(Number)
      return monthRange(year, month)
    }
    case 'custom':
      return {
        ...(date.from ? { takenFrom: date.from } : {}),
        ...(date.to ? { takenTo: date.to } : {})
      }
  }
}

export type GalleryMediaQuery = Pick<
  GetGalleryMediaOptions,
  'sort' | 'subject' | 'place' | 'takenFrom' | 'takenTo' | 'activityId'
>

/** The media-list options a filter state stands for; `notInAlbum` is the host's. */
export const toGalleryMediaQuery = (
  state: GalleryMediaFilterState,
  today: Date
): GalleryMediaQuery => ({
  sort: state.sort,
  ...(state.species !== null ? { subject: state.species } : {}),
  ...(state.place !== null ? { place: state.place } : {}),
  ...(state.date ? getDateRange(state.date, today) : {}),
  ...(state.activity !== null ? { activityId: state.activity } : {})
})

export const GALLERY_SORT_OPTIONS: Array<{
  id: GalleryMediaSort
  label: string
  short: string
  trigger: string
}> = [
  {
    id: 'taken_desc',
    label: 'Date taken, newest first',
    short: 'Newest',
    trigger: 'Date taken, newest'
  },
  {
    id: 'taken_asc',
    label: 'Date taken, oldest first',
    short: 'Oldest',
    trigger: 'Date taken, oldest'
  },
  {
    id: 'uploaded',
    label: 'Recently uploaded',
    short: 'Uploaded',
    trigger: 'Recently uploaded'
  }
]
