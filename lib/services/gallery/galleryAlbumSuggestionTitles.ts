import type { GalleryIndexRow } from '@/lib/database/sql/galleryMedia'
import {
  PublicPlaceSettings,
  getPublicPlace
} from '@/lib/services/gallery/publicMediaDetails'
import { MAX_GALLERY_ALBUM_TITLE_LENGTH } from '@/lib/types/database/galleryAlbums'

// The titles album suggestions pre-fill. A title is public text once the album
// is public, and it is not run through `getPublicPlace` the way an item's place
// is, so a title may carry a place name only when every photo of the cluster
// shows that one place to the public. A hidden location, a hidden precision, a
// threatened species (or one whose check failed or has not finished), a photo
// with no place at all and photos at more than one place each make the whole
// title dates. The callers pass the photos a visitor can see, not the owner's
// whole cluster, and a group with none gets a generic title with no date.
//
// Dates are the UTC days the album shows (an album's dates are UTC), formatted
// from the UTC midnight of a day key with fixed month tables, so a title is the
// same on every machine and for both databases.

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

// What a title says when no photo of the group is visible to a visitor: nothing
// they could read a date, a place or a species from.
const GENERIC_TRIP_TITLE = 'Trip'
const GENERIC_SPECIES_TITLE = 'Species series'
const GENERIC_DAY_TITLE = 'Day out'

// The most characters of a place name in a title, leaving room for the date.
const MAX_PLACE_NAME_LENGTH = 80

interface Day {
  year: number
  month: number
  day: number
}

const toDay = (ms: number): Day => {
  const date = new Date(ms)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate()
  }
}

const clamp = (title: string): string =>
  title.length <= MAX_GALLERY_ALBUM_TITLE_LENGTH
    ? title
    : `${title.slice(0, MAX_GALLERY_ALBUM_TITLE_LENGTH - 1).trimEnd()}…`

/**
 * "12–19 Sep 2026" inside a month, "28 Aug–3 Sep 2026" across months,
 * "28 Dec 2025–3 Jan 2026" across years and "12 Sep 2026" for one day.
 */
export const formatSuggestionDays = (
  firstMs: number,
  lastMs: number
): string => {
  const start = toDay(Math.min(firstMs, lastMs))
  const end = toDay(Math.max(firstMs, lastMs))
  const full = ({ day, month, year }: Day) =>
    `${day} ${MONTHS_SHORT[month]} ${year}`
  if (start.year === end.year && start.month === end.month) {
    return start.day === end.day
      ? full(start)
      : `${start.day}–${end.day} ${MONTHS_SHORT[end.month]} ${end.year}`
  }
  if (start.year === end.year) {
    return `${start.day} ${MONTHS_SHORT[start.month]}–${full(end)}`
  }
  return `${full(start)}–${full(end)}`
}

/**
 * "September 2026" inside a month, "Aug–Sep 2026" across months and
 * "Dec 2025–Jan 2026" across years.
 */
export const formatSuggestionMonths = (
  firstMs: number,
  lastMs: number
): string => {
  const start = toDay(Math.min(firstMs, lastMs))
  const end = toDay(Math.max(firstMs, lastMs))
  if (start.year === end.year && start.month === end.month) {
    return `${MONTHS_LONG[start.month]} ${start.year}`
  }
  if (start.year === end.year) {
    return `${MONTHS_SHORT[start.month]}–${MONTHS_SHORT[end.month]} ${end.year}`
  }
  return `${MONTHS_SHORT[start.month]} ${start.year}–${MONTHS_SHORT[end.month]} ${end.year}`
}

/**
 * The one name every photo of the cluster shows publicly, or null. Null as soon
 * as one photo's public place is withheld, unnamed or missing, and null when the
 * photos show more than one name: naming the place would then tell a visitor
 * about a trip the owner chose not to place (or about a species whose location is
 * protected), and one name of several would call a trip through two places by
 * just one of them. Pass the rows a visitor can see, so a hidden photo never
 * decides the title.
 */
export const getSafePlaceName = (
  rows: GalleryIndexRow[],
  settings: PublicPlaceSettings
): string | null => {
  if (rows.length === 0) return null
  let name: string | null = null
  for (const row of rows) {
    const rowName = getPublicPlace(row, settings)?.name?.trim()
    if (!rowName) return null
    if (name !== null && rowName !== name) return null
    name = rowName
  }
  return name ? name.slice(0, MAX_PLACE_NAME_LENGTH).trimEnd() : null
}

/**
 * "Kruger, September 2026" when the place is safe, else "Trip, 12–19 Sep 2026".
 * `shown` are the photos a visitor can see and the dates are theirs; with none,
 * the title is a plain "Trip" (no dates, no place).
 */
export const getTripTitle = (
  shown: GalleryIndexRow[],
  settings: PublicPlaceSettings,
  firstMs: number,
  lastMs: number
): string => {
  if (shown.length === 0) return GENERIC_TRIP_TITLE
  const place = getSafePlaceName(shown, settings)
  return clamp(
    place
      ? `${place}, ${formatSuggestionMonths(firstMs, lastMs)}`
      : `Trip, ${formatSuggestionDays(firstMs, lastMs)}`
  )
}

/** The species' name (of a photo a visitor can see); no place, no dates. */
export const getSpeciesTitle = (name: string): string =>
  clamp(name.trim() || GENERIC_SPECIES_TITLE)

/**
 * "Activity day, 27 Sep 2026" when one of the day's activities is on a post a
 * visitor can read, else just the date ("27 Sep 2026"): the words would tell a
 * visitor an activity was recorded. `null` for a day none of whose photos a
 * visitor can see, which gets a title with no date at all.
 */
export const getActivityDayTitle = (
  dayMs: number | null,
  hasPublicActivity: boolean
): string => {
  if (dayMs === null) return GENERIC_DAY_TITLE
  const date = formatSuggestionDays(dayMs, dayMs)
  return clamp(hasPublicActivity ? `Activity day, ${date}` : date)
}
