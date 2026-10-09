import type { GalleryIndexRow } from '@/lib/database/sql/galleryMedia'
import { localDateKeyAt } from '@/lib/fitness/calendar/localDay'
import { toSubjectKey } from '@/lib/services/gallery/galleryEntities'

// The grouping behind the album suggestions: pure functions over the light
// per-media index, in JS, so SQLite (timestamps as numbers or text) and
// PostgreSQL group the same photos.
//
// A day is the calendar date of a photo's `takenAt` in the viewer's time zone
// (`timeZone`, an IANA name; UTC by default), the same zone the recorded
// activities are bucketed in, so a photo and an activity of one local day meet.
// `takenAt` is a real instant for a photo whose EXIF carries a UTC offset, and
// the camera's wall clock stored as if it were UTC for one that does not; the
// first is exact in the viewer's zone, the second is exact when the viewer is
// in the zone the photo was taken in (and for UTC viewers). Days come from
// `Intl` through `localDateKeyAt`, never from the machine's zone.

const DAY_MS = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` of the day an instant falls on in `timeZone`, or null when it is not a usable date. */
export const toLocalDayKey = (ms: number, timeZone = 'UTC'): string | null => {
  if (!Number.isFinite(ms)) return null
  try {
    return localDateKeyAt(ms, timeZone)
  } catch {
    return null
  }
}

/** UTC midnight of a `YYYY-MM-DD` key: the instant a title formats as that date. */
export const dayKeyToMs = (key: string): number =>
  Date.parse(`${key}T00:00:00.000Z`)

/** Whole days since 1970-01-01 of the local calendar date an instant falls on. */
export const toLocalDayNumber = (
  ms: number,
  timeZone = 'UTC'
): number | null => {
  const key = toLocalDayKey(ms, timeZone)
  return key === null ? null : Math.round(dayKeyToMs(key) / DAY_MS)
}

/** When a photo was taken, or uploaded when it carries no capture date. */
export const getRowTime = (row: GalleryIndexRow): number =>
  row.takenAt ?? row.createdAt

/** Newest first (capture date, upload date when none), then the higher media id. */
export const compareNewestFirst = (
  a: GalleryIndexRow,
  b: GalleryIndexRow
): number => getRowTime(b) - getRowTime(a) || Number(b.id) - Number(a.id)

const compareOldestFirst = (a: GalleryIndexRow, b: GalleryIndexRow): number =>
  (a.takenAt as number) - (b.takenAt as number) || Number(a.id) - Number(b.id)

const isDated = (
  row: GalleryIndexRow,
  timeZone: string
): row is GalleryIndexRow & {
  takenAt: number
} => row.takenAt !== null && toLocalDayKey(row.takenAt, timeZone) !== null

/**
 * Trips: photos with a capture date, split wherever two neighbouring local days
 * are more than `maxGapDays` apart (a gap of exactly `maxGapDays` stays one
 * trip), keeping the runs of at least `minPhotos`. A photo with no capture date
 * is skipped: its upload day is when it was posted, not when it was taken, and a
 * bulk upload would read as a trip.
 */
export const clusterTrips = (
  rows: GalleryIndexRow[],
  {
    maxGapDays,
    minPhotos,
    timeZone = 'UTC'
  }: { maxGapDays: number; minPhotos: number; timeZone?: string }
): GalleryIndexRow[][] => {
  const dated = rows
    .filter((row) => isDated(row, timeZone))
    .sort(compareOldestFirst)
  const clusters: GalleryIndexRow[][] = []
  let current: GalleryIndexRow[] = []
  let lastDay = 0
  for (const row of dated) {
    const day = toLocalDayNumber(row.takenAt as number, timeZone) as number
    if (current.length > 0 && day - lastDay > maxGapDays) {
      clusters.push(current)
      current = []
    }
    current.push(row)
    lastDay = day
  }
  if (current.length > 0) clusters.push(current)
  return clusters.filter((cluster) => cluster.length >= minPhotos)
}

/** Species with at least `minPhotos` photos, by `toSubjectKey`. */
export const groupSpecies = (
  rows: GalleryIndexRow[],
  minPhotos: number
): Map<string, GalleryIndexRow[]> => {
  const groups = new Map<string, GalleryIndexRow[]>()
  for (const row of rows) {
    const key = toSubjectKey({
      name: row.subjectName,
      scientificName: row.subjectScientificName
    })
    if (!key) continue
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  for (const [key, group] of groups) {
    if (group.length < minPhotos) groups.delete(key)
  }
  return groups
}

/**
 * Local days (`YYYY-MM-DD` in `timeZone`) with at least `minPhotos` photos taken
 * that day. Only photos with a capture date count, as for trips.
 */
export const groupPhotosByDay = (
  rows: GalleryIndexRow[],
  minPhotos: number,
  timeZone = 'UTC'
): Map<string, GalleryIndexRow[]> => {
  const days = new Map<string, GalleryIndexRow[]>()
  for (const row of rows) {
    if (!isDated(row, timeZone)) continue
    const key = toLocalDayKey(row.takenAt, timeZone)
    if (!key) continue
    const group = days.get(key)
    if (group) group.push(row)
    else days.set(key, [row])
  }
  for (const [key, group] of days) {
    if (group.length < minPhotos) days.delete(key)
  }
  return days
}

/**
 * Whether one album already holds every one of the media ids: such a
 * suggestion is done, and would only keep coming back.
 */
export const isCoveredByOneAlbum = (
  mediaIds: readonly string[],
  albums: ReadonlyMap<string, ReadonlySet<string>>
): boolean => {
  if (mediaIds.length === 0) return true
  for (const items of albums.values()) {
    if (items.size < mediaIds.length) continue
    if (mediaIds.every((id) => items.has(id))) return true
  }
  return false
}
