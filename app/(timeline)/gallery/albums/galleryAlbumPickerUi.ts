import type { KeyboardEvent } from 'react'

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
 * Narrows the loaded photos by species, place and capture day. A photo with no capture
 * date never matches a date bound: it cannot be said to fall in the range.
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
      const day = item.takenAt?.slice(0, 10)
      if (!day) return false
      if (from && day < from) return false
      if (to && day > to) return false
    }
    return true
  })
}
