// Pure helpers for `fitness_file_routes` rows: the row mapper, the bounding
// box parser it shares with the bounds aggregate, and the box an upsert
// derives from its points. No database access.
import type { Selectable } from 'kysely'

import type { FitnessFileRoutes } from '@/lib/database/kysely/db'
import type {
  FitnessFileRoute,
  FitnessFileRoutePoint
} from '@/lib/types/database/fitnessFileRoute'
import type { FitnessRouteHeatmapBounds } from '@/lib/types/database/fitnessRouteHeatmap'

export type FitnessFileRouteRow = Selectable<FitnessFileRoutes>

/**
 * The four bounding-box columns, null on all four when the activity carries
 * no GPS at all. Read loosely, because the bounds aggregate's `min`/`max`
 * columns have no declared type on SQLite.
 */
type RouteBoxColumns = {
  minLat: unknown
  maxLat: unknown
  minLng: unknown
  maxLng: unknown
}

const parseRoutePoints = (value: string | null): FitnessFileRoutePoint[] => {
  if (!value) return []

  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (point): point is FitnessFileRoutePoint =>
        Array.isArray(point) &&
        point.length === 2 &&
        typeof point[0] === 'number' &&
        typeof point[1] === 'number'
    )
  } catch {
    // A corrupt payload is a cache miss, not a failure: the caller re-derives
    // the route from the source file. Throwing here would take down a whole
    // rebuild over one bad row.
    return []
  }
}

const parseCoordinate = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export const parseRouteBounds = (
  row: RouteBoxColumns
): FitnessRouteHeatmapBounds | undefined => {
  const minLat = parseCoordinate(row.minLat)
  const maxLat = parseCoordinate(row.maxLat)
  const minLng = parseCoordinate(row.minLng)
  const maxLng = parseCoordinate(row.maxLng)

  // All four or nothing: a partially-null box would describe a region the
  // route does not occupy.
  if (
    minLat === null ||
    maxLat === null ||
    minLng === null ||
    maxLng === null
  ) {
    return undefined
  }

  return { minLat, maxLat, minLng, maxLng }
}

/**
 * A `fitness_file_routes` row as the domain `FitnessFileRoute`. The driver
 * has already read the timestamps as epoch milliseconds on both backends.
 */
export const toFitnessFileRoute = (
  row: FitnessFileRouteRow
): FitnessFileRoute => {
  const points = parseRoutePoints(row.points)
  return {
    fitnessFileId: row.fitnessFileId,
    actorId: row.actorId,
    points,
    pointCount: Number(row.pointCount ?? points.length),
    bounds: parseRouteBounds(row),
    sourceVersion: Number(row.sourceVersion ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export const calculateRouteBounds = (
  points: FitnessFileRoutePoint[]
): FitnessRouteHeatmapBounds | null => {
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY

  for (const [lat, lng] of points) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
    minLng = Math.min(minLng, lng)
    maxLng = Math.max(maxLng, lng)
  }

  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null
  return { minLat, maxLat, minLng, maxLng }
}
