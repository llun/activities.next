import type { GalleryMapPoint } from '@/lib/services/gallery/galleryEntities'

export const UNNAMED_PLACE = 'Unnamed place'
const MAX_PLACE_THUMBNAILS = 3

export interface GalleryPlaceGroup {
  name: string
  count: number
  thumbnails: string[]
  /** Distinct subject names seen at the place. */
  subjectCount: number
  /** ISO timestamp of the newest capture date at the place, if any is known. */
  lastTakenAt: string | null
}

const compareIso = (left: string, right: string): number =>
  Date.parse(left) - Date.parse(right)

/**
 * The map's points grouped by place name, biggest place first (ties by name so
 * the order is stable). Points without a name share one "Unnamed place" group.
 * Everything here is derived from the points the server already projected, so
 * it never discloses more than the map does.
 */
export const groupPointsByPlace = (
  points: readonly GalleryMapPoint[]
): GalleryPlaceGroup[] => {
  const groups = new Map<
    string,
    GalleryPlaceGroup & { subjects: Set<string> }
  >()

  for (const point of points) {
    const name = point.placeName?.trim() || UNNAMED_PLACE
    let group = groups.get(name)
    if (!group) {
      group = {
        name,
        count: 0,
        thumbnails: [],
        subjectCount: 0,
        lastTakenAt: null,
        subjects: new Set()
      }
      groups.set(name, group)
    }
    group.count += 1
    if (
      point.thumbnailUrl &&
      group.thumbnails.length < MAX_PLACE_THUMBNAILS &&
      !group.thumbnails.includes(point.thumbnailUrl)
    ) {
      group.thumbnails.push(point.thumbnailUrl)
    }
    if (point.subjectName) group.subjects.add(point.subjectName)
    if (
      point.takenAt &&
      Number.isFinite(Date.parse(point.takenAt)) &&
      (!group.lastTakenAt || compareIso(point.takenAt, group.lastTakenAt) > 0)
    ) {
      group.lastTakenAt = point.takenAt
    }
  }

  return [...groups.values()]
    .map(({ subjects, ...group }) => ({
      ...group,
      subjectCount: subjects.size
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name)
    )
}

/** The bounding box of the points, for framing the map. Null when empty. */
export const getPointBounds = (
  points: readonly GalleryMapPoint[]
): {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
} | null => {
  if (points.length === 0) return null
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const point of points) {
    minLat = Math.min(minLat, point.latitude)
    maxLat = Math.max(maxLat, point.latitude)
    minLng = Math.min(minLng, point.longitude)
    maxLng = Math.max(maxLng, point.longitude)
  }
  return { minLat, maxLat, minLng, maxLng }
}
