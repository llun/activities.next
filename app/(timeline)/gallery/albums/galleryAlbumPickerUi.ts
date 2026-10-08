import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'

export interface PickerFilters {
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

/**
 * Narrows the loaded photos by place and capture day. A photo with no capture
 * date never matches a date bound: it cannot be said to fall in the range.
 */
export const filterPickerItems = (
  items: GalleryItemEntity[],
  { place, from, to }: PickerFilters
): GalleryItemEntity[] => {
  if (!place && !from && !to) return items
  return items.filter((item) => {
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
