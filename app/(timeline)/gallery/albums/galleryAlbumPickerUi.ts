import type { KeyboardEvent } from 'react'

import { formatGalleryDate } from '@/lib/components/gallery/galleryCategories'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'

export interface PickerFilters {
  /** A species label from `getPickerSubjectNames`; empty or absent for any. */
  species?: string
  /** A place name from `getPickerPlaceNames`; empty for any. */
  place: string
  /** `YYYY-MM-DD` (UTC), inclusive; empty for open. */
  from: string
  to: string
}

/** The distinct place names of the photos, sorted. */
export const getPickerPlaceNames = (items: GalleryItemEntity[]): string[] =>
  [
    ...new Set(
      items.flatMap((item) => {
        const name = item.place?.name?.trim()
        return name ? [name] : []
      })
    )
  ].sort((left, right) => left.localeCompare(right, 'en'))

/** The name a photo's species goes by in a filter: common name, else scientific. */
const getSubjectLabel = (item: GalleryItemEntity): string =>
  item.subject?.name?.trim() || item.subject?.scientificName?.trim() || ''

/** The distinct species labels of the photos, sorted. */
export const getPickerSubjectNames = (items: GalleryItemEntity[]): string[] =>
  [
    ...new Set(
      items.flatMap((item) => {
        const label = getSubjectLabel(item)
        return label ? [label] : []
      })
    )
  ].sort((left, right) => left.localeCompare(right, 'en'))

/**
 * A date field submits its form on Enter; in the album dialog Enter must not
 * save an album the owner has not finished picking for.
 */
export const ignoreEnter = (event: KeyboardEvent) => {
  if (event.key === 'Enter') event.preventDefault()
}

/**
 * Narrows the loaded photos by species, place and capture day, falling back to
 * upload day. A photo with neither date never matches a date bound: it cannot
 * be said to fall in the range.
 */
export const filterPickerItems = (
  items: GalleryItemEntity[],
  { species = '', place, from, to }: PickerFilters
): GalleryItemEntity[] => {
  if (!species && !place && !from && !to) return items
  return items.filter((item) => {
    if (species && getSubjectLabel(item) !== species) return false
    if (place && item.place?.name?.trim() !== place) return false
    if (from || to) {
      const day = (item.takenAt ?? item.uploadedAt)?.slice(0, 10)
      if (!day) return false
      if (from && day < from) return false
      if (to && day > to) return false
    }
    return true
  })
}

const getPickerDateText = (item: GalleryItemEntity): string => {
  if (item.takenAt) {
    return formatGalleryDate(item.takenAt)
  }
  if (item.uploadedAt) {
    const formatted = formatGalleryDate(item.uploadedAt)
    return formatted ? `Uploaded ${formatted}` : ''
  }
  return ''
}

/** "Common kingfisher · 12 Sep 2026", the date alone without a species, the upload date without a capture date. */
export const getPickerCaption = (
  item: GalleryItemEntity,
  { date = true }: { date?: boolean } = {}
): string => {
  const dateText = date ? getPickerDateText(item) : ''
  return [item.subject?.name, dateText].filter(Boolean).join(' · ')
}

/**
 * The tile's date for the accessible name: "taken 12 Sep 2026" or, without a
 * capture date, "uploaded 3 Oct 2025"; '' when neither date parses.
 */
export const getPickerTileDate = (item: GalleryItemEntity): string => {
  if (item.takenAt) {
    const formatted = formatGalleryDate(item.takenAt)
    if (formatted) return `taken ${formatted}`
  }
  if (item.uploadedAt) {
    const formatted = formatGalleryDate(item.uploadedAt)
    if (formatted) return `uploaded ${formatted}`
  }
  return ''
}

/** Badge words for the accessible name, in display order. */
export const getPickerBadges = (item: GalleryItemEntity): string[] => {
  const badges: string[] = []
  if (item.inGallery === false) {
    badges.push('not in gallery')
  }
  const count = item.albumCount ?? 0
  if (count > 0) {
    badges.push(`in ${count} ${count === 1 ? 'album' : 'albums'}`)
  }
  return badges
}

/**
 * Top of the nearest scrolling ancestor (the dialog body). When the document
 * scrolls instead, the root's scroll-padding-top (the mobile compact header)
 * is the line the element must clear.
 */
const getScrollParentTop = (element: HTMLElement): number => {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const { overflowY } = getComputedStyle(parent)
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return parent.getBoundingClientRect().top
    }
  }
  return (
    parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
  )
}

/**
 * Brings the filter bar (the top of the results) back into view after a
 * filter or sort change, only when its top is off-screen, under a sticky
 * header (the element's scroll-margin-top) or clipped by the scroll container
 * it sits in; no animation when the reader prefers reduced motion.
 */
export const scrollToResultsStart = (element: HTMLElement | null) => {
  if (!element || typeof element.scrollIntoView !== 'function') return
  const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0
  const top = getScrollParentTop(element) + margin
  if (element.getBoundingClientRect().top >= top) return
  const reduce =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView({
    block: 'start',
    behavior: reduce ? 'auto' : 'smooth'
  })
}
