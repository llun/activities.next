import type {
  GalleryGearEntity,
  GalleryGearWithUsageEntity
} from '@/lib/services/gallery/galleryEntities'

// Presentation helpers for the Gallery gear pages. Pure, so the date wording
// can be tested without rendering.
//
// Dates render in UTC: a capture time is stored as the camera's wall clock read
// as UTC, so converting it to the reader's zone would move a photo taken late
// in the evening onto another day.

const monthYearFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  year: 'numeric'
})

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})

export const formatGearMonth = (milliseconds: number): string =>
  monthYearFormatter.format(new Date(milliseconds))

/** "14 Mar 2024". */
export const formatGearDay = (milliseconds: number): string =>
  dayFormatter.format(new Date(milliseconds))

type UsageDates = Pick<GalleryGearWithUsageEntity, 'firstUsedAt' | 'retiredAt'>

/**
 * The list's "Used" column: "Mar 2024 to now" for gear in use, "Mar 2022 to
 * Feb 2024" once retired (to the month it was put away), and a dash for gear with nothing posted yet.
 */
export const getGearUsedLabel = (gear: UsageDates): string => {
  if (gear.firstUsedAt === null) return '—'
  const start = formatGearMonth(gear.firstUsedAt)
  if (gear.retiredAt === null) return `${start} to now`
  const end = formatGearMonth(gear.retiredAt)
  return start === end ? start : `${start} to ${end}`
}

/** "Brand · Model" for the list's second line. */
export const getGearSubline = (
  gear: Pick<GalleryGearEntity, 'brand' | 'model'>
): string => [gear.brand, gear.model].filter(Boolean).join(' · ')

/** "Brand Model" for the detail page's meta line. */
export const getGearBrandModel = (
  gear: Pick<GalleryGearEntity, 'brand' | 'model'>
): string => [gear.brand, gear.model].filter(Boolean).join(' ')

export const getGearHref = (gearId: string): string =>
  `/gallery/gear/${encodeURIComponent(gearId)}`
