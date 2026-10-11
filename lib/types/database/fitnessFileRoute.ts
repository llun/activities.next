import { FitnessRouteHeatmapBounds } from '@/lib/types/database/fitnessRouteHeatmap'

/**
 * One recorded position, as a `[lat, lng]` tuple rather than an object. A long
 * ride caches a few thousand of these per activity and an actor caches
 * thousands of activities, so the tuple form is chosen for the stored JSON:
 * it is roughly a third of the bytes of `{"lat":…,"lng":…}` and parses
 * proportionally faster.
 */
export type FitnessFileRoutePoint = [lat: number, lng: number]

export interface FitnessFileRoute {
  fitnessFileId: string
  actorId: string
  points: FitnessFileRoutePoint[]
  pointCount: number
  /**
   * Undefined when the activity has no GPS. That is a real, cached answer —
   * the row exists precisely so a rebuild does not re-download the file to
   * rediscover it — and is not the same as having no row at all.
   */
  bounds?: FitnessRouteHeatmapBounds
  /**
   * The representation version the row was written at. A reader that expects a
   * newer version must re-derive the route from the source file rather than
   * trust these points.
   */
  sourceVersion: number
  createdAt: number
  updatedAt: number
}
