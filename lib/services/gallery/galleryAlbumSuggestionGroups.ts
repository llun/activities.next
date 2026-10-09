import type { GalleryIndexRow } from '@/lib/database/sql/galleryMedia'
import { localDateKeyAt } from '@/lib/fitness/calendar/localDay'
import { toSubjectKey } from '@/lib/services/gallery/galleryEntities'

// The grouping behind the album suggestions: pure functions over the light
// per-media index, in JS, so SQLite (timestamps as numbers or text) and
// PostgreSQL group the same photos.
//
// A photo's day is the UTC calendar date of its `takenAt`, the same date the rest
// of the gallery shows (the album card and page format dates in UTC), so a
// suggestion's title, ids and date range always agree with the album it
// becomes. `takenAt` is a real instant when the photo's EXIF carries a UTC
// offset, and the camera's wall clock stored as if it were UTC when it does not;
// the media row does not record which, so a UTC day is right for a wall-clock
// photo (a 23:50 shot stays on its day) and can be a day off for an instant
// that is near midnight where the viewer is. `photoActivityDays` is where that
// matters: it lists both readings of a photo's day so an activity still finds it.
// Days come from epoch milliseconds, never from the machine's zone.

const DAY_MS = 24 * 60 * 60 * 1000

/** The UTC day number of an instant: whole days since 1970-01-01. */
export const toUtcDayNumber = (ms: number): number => Math.floor(ms / DAY_MS)

/** `YYYY-MM-DD` (UTC) of an instant, or null when it is not a usable date. */
export const toUtcDayKey = (ms: number): string | null => {
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` of the day an instant falls on in `timeZone`, or null when it is not a usable date. */
export const toLocalDayKey = (ms: number, timeZone: string): string | null => {
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
  row: GalleryIndexRow
): row is GalleryIndexRow & {
  takenAt: number
} => row.takenAt !== null && toUtcDayKey(row.takenAt) !== null

/**
 * Trips: photos with a capture date, split wherever two neighbouring days are
 * more than `maxGapDays` apart (a gap of exactly `maxGapDays` stays one
 * trip), keeping the runs of at least `minPhotos`. A photo with no capture date
 * is skipped: its upload day is when it was posted, not when it was taken, and a
 * bulk upload would read as a trip.
 */
export const clusterTrips = (
  rows: GalleryIndexRow[],
  { maxGapDays, minPhotos }: { maxGapDays: number; minPhotos: number }
): GalleryIndexRow[][] => {
  const dated = rows.filter(isDated).sort(compareOldestFirst)
  const clusters: GalleryIndexRow[][] = []
  let current: GalleryIndexRow[] = []
  let lastDay = 0
  for (const row of dated) {
    const day = toUtcDayNumber(row.takenAt as number)
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
 * Days (UTC date key) with at least `minPhotos` photos taken that day. Only
 * photos with a capture date count, as for trips.
 */
export const groupPhotosByDay = (
  rows: GalleryIndexRow[],
  minPhotos: number
): Map<string, GalleryIndexRow[]> => {
  const days = new Map<string, GalleryIndexRow[]>()
  for (const row of rows) {
    if (!isDated(row)) continue
    const key = toUtcDayKey(row.takenAt)
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
 * The days an activity could be on for the photos of one UTC day: the day
 * itself (right for a photo whose `takenAt` is a wall clock) and the day each
 * photo falls on in the viewer's zone (right for one whose `takenAt` is a real
 * instant). A photo day is matched by an activity on any of them.
 */
export const photoActivityDays = (
  utcDay: string,
  rows: GalleryIndexRow[],
  timeZone: string
): string[] => {
  const days = new Set([utcDay])
  for (const row of rows) {
    if (row.takenAt === null) continue
    const local = toLocalDayKey(row.takenAt, timeZone)
    if (local) days.add(local)
  }
  return [...days].sort()
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
