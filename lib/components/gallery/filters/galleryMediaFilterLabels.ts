import { formatActivityTypeLabel } from '@/lib/services/fitness-files/activityPresentation'
import {
  SPORT_LABELS,
  normalizeActivityTypeToSportKey
} from '@/lib/services/fitness-files/sportTypes'
import type {
  GalleryActivityFacet,
  GalleryMediaFacetsResponse,
  GallerySpeciesFacet
} from '@/lib/services/gallery/galleryEntities'
import { GALLERY_FILTER_NONE } from '@/lib/types/database/gallery'
import { formatFitnessDistance } from '@/lib/utils/fitness'

import type {
  GalleryDateFilter,
  GalleryFilterKey,
  GalleryMediaFilterState
} from './galleryMediaFilterState'

const EN_DASH = ' \u2013 '

const SHORT_MONTH_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'UTC'
})

const SHORT_MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
})

const FULL_MONTH_YEAR_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC'
})

const ACTIVITY_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
})

const parseUtcDay = (dateStr: string): Date | null => {
  const parts = dateStr.trim().split('-').map(Number)
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null
  }
  const [year, month, day] = parts
  const date = new Date(Date.UTC(year, month - 1, day))
  return Number.isNaN(date.getTime()) ? null : date
}

const formatDayMonth = (date: Date): string =>
  `${date.getUTCDate()} ${SHORT_MONTH_FORMATTER.format(date)}`

const formatDayMonthYear = (date: Date): string =>
  `${date.getUTCDate()} ${SHORT_MONTH_FORMATTER.format(date)} ${date.getUTCFullYear()}`

const stripSpeciesKey = (key: string): string => {
  const stripped = key.replace(/^(name|sci):/, '')
  return stripped || 'Species'
}

export const formatSpeciesLabel = (
  facet: GallerySpeciesFacet | undefined,
  key: string | null
): string => {
  if (facet) {
    return (
      facet.name ??
      facet.scientificName ??
      (key ? stripSpeciesKey(key) : 'Species')
    )
  }
  return key ? stripSpeciesKey(key) : 'Species'
}

export const formatPlaceLabel = (place: string | null | undefined): string => {
  if (place === GALLERY_FILTER_NONE) {
    return 'No place'
  }
  if (typeof place === 'string' && place.trim().length > 0) {
    return place
  }
  return 'Any place'
}

export const formatMonthFacetLabel = (monthStr: string): string => {
  const [yearStr, monthPart] = monthStr.split('-')
  const year = Number(yearStr)
  const month = Number(monthPart)
  if (!year || !month || Number.isNaN(year) || Number.isNaN(month)) {
    return monthStr
  }
  const date = new Date(Date.UTC(year, month - 1, 1))
  return FULL_MONTH_YEAR_FORMATTER.format(date)
}

export const formatDateFilterChipLabel = (
  date: GalleryDateFilter | null | undefined
): string => {
  if (!date) {
    return 'Any time'
  }

  switch (date.kind) {
    case 'this_month':
      return 'This month'
    case 'this_year':
      return 'This year'
    case 'year':
      return `${date.year}`
    case 'month': {
      const [yearStr, monthPart] = date.month.split('-')
      const year = Number(yearStr)
      const month = Number(monthPart)
      if (!year || !month || Number.isNaN(year) || Number.isNaN(month)) {
        return date.month
      }
      const d = new Date(Date.UTC(year, month - 1, 1))
      return SHORT_MONTH_YEAR_FORMATTER.format(d)
    }
    case 'custom': {
      const fromDate = date.from ? parseUtcDay(date.from) : null
      const toDate = date.to ? parseUtcDay(date.to) : null

      if (fromDate && toDate) {
        if (
          fromDate.getUTCFullYear() === toDate.getUTCFullYear() &&
          fromDate.getUTCMonth() === toDate.getUTCMonth() &&
          fromDate.getUTCDate() === toDate.getUTCDate()
        ) {
          return formatDayMonthYear(fromDate)
        }
        if (fromDate.getUTCFullYear() === toDate.getUTCFullYear()) {
          return `${formatDayMonth(fromDate)}${EN_DASH}${formatDayMonthYear(toDate)}`
        }
        return `${formatDayMonthYear(fromDate)}${EN_DASH}${formatDayMonthYear(toDate)}`
      }
      if (fromDate) {
        return `From ${formatDayMonthYear(fromDate)}`
      }
      if (toDate) {
        return `Until ${formatDayMonthYear(toDate)}`
      }
      return 'Any time'
    }
  }
}

export const formatActivityTitle = (
  facet: GalleryActivityFacet | undefined,
  activityId: string | null
): string => {
  if (activityId === GALLERY_FILTER_NONE) {
    return 'Not from an activity'
  }
  if (facet) {
    let sportLabel = 'Activity'
    if (facet.activityType) {
      const sportKey = normalizeActivityTypeToSportKey(facet.activityType)
      if (sportKey && SPORT_LABELS[sportKey]) {
        sportLabel = SPORT_LABELS[sportKey]
      } else {
        sportLabel = formatActivityTypeLabel(facet.activityType)
      }
    }

    const distance =
      typeof facet.distanceMeters === 'number' && facet.distanceMeters > 0
        ? formatFitnessDistance(facet.distanceMeters)
        : null

    if (distance) {
      return `${sportLabel} · ${distance}`
    }
    return sportLabel
  }
  if (activityId) {
    return 'Activity'
  }
  return 'Any activity'
}

export const formatActivitySubtitle = (
  facet: GalleryActivityFacet
): string | null => {
  let datePart: string | null = null
  if (facet.startTime) {
    const date = new Date(facet.startTime)
    if (!Number.isNaN(date.getTime())) {
      const parts = ACTIVITY_DATE_FORMATTER.formatToParts(date)
      const get = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value ?? ''
      datePart = `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`
    }
  }

  const placePart =
    facet.placeName && facet.placeName.trim().length > 0
      ? facet.placeName.trim()
      : null

  if (datePart && placePart) {
    return `${datePart} · ${placePart}`
  }
  return datePart ?? placePart ?? null
}

export const formatFilterActiveValue = (
  filters: GalleryMediaFilterState,
  key: GalleryFilterKey,
  facets: GalleryMediaFacetsResponse | null
): string => {
  switch (key) {
    case 'species': {
      const facet = facets?.species?.find((f) => f.key === filters.species)
      return formatSpeciesLabel(facet, filters.species)
    }
    case 'place':
      return formatPlaceLabel(filters.place)
    case 'date':
      return formatDateFilterChipLabel(filters.date)
    case 'activity': {
      const facet = facets?.activities?.find((f) => f.id === filters.activity)
      return formatActivityTitle(facet, filters.activity)
    }
    case 'notInAlbum':
      return 'Not in an album'
  }
}

export const formatEmptyStateDescription = (
  filters: GalleryMediaFilterState,
  facets: GalleryMediaFacetsResponse | null
): string =>
  filters.order
    .map((key) => formatFilterActiveValue(filters, key, facets))
    .filter(Boolean)
    .join(' · ')

export const formatRemoveFilterLabel = (
  filters: GalleryMediaFilterState,
  facets: GalleryMediaFacetsResponse | null
): string | null => {
  if (filters.order.length === 0) {
    return null
  }
  const lastKey = filters.order[filters.order.length - 1]
  const valueLabel = formatFilterActiveValue(filters, lastKey, facets)
  return `Remove ${valueLabel}`
}
