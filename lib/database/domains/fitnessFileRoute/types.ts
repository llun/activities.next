// Parameter types and the `FitnessFileRouteDatabase` interface of the cached
// route domain. The parsed `FitnessFileRoute` type lives in
// lib/types/database/fitnessFileRoute.ts; the stored row type is the generated
// `FitnessFileRoutes` table type in lib/database/kysely/db.ts.
import type {
  FitnessFileRoute,
  FitnessFileRoutePoint
} from '@/lib/types/database/fitnessFileRoute'
import type { FitnessRouteHeatmapBounds } from '@/lib/types/database/fitnessRouteHeatmap'

export interface UpsertFitnessFileRouteParams {
  fitnessFileId: string
  actorId: string
  /**
   * The already-simplified route. Pass an empty array for an activity with no
   * GPS: the row is still written, as a negative cache, so a rebuild does not
   * re-download and re-parse the file only to rediscover it has no route.
   */
  points: FitnessFileRoutePoint[]
  sourceVersion: number
}

export interface FitnessFileRouteBoundsParams {
  actorId: string
  /** Restrict to routes whose own bounding box intersects this rectangle. */
  bounds?: FitnessRouteHeatmapBounds
}

export interface FitnessFileRouteDatabase {
  /**
   * Writes (or replaces) an activity's cached route. Idempotent on the
   * `fitnessFileId` primary key, because the writer is a job that can re-run.
   */
  upsertFitnessFileRoute(params: UpsertFitnessFileRouteParams): Promise<void>
  /**
   * Reads cached routes for a page of activities. Returns only the rows that
   * exist — a caller treats a missing id as a cache miss and derives it from
   * the source file — and does not filter on `sourceVersion`, so the caller can
   * tell a stale row apart from an absent one and decide what to do.
   */
  getFitnessFileRoutes(params: {
    fitnessFileIds: string[]
  }): Promise<FitnessFileRoute[]>
  deleteFitnessFileRoute(params: { fitnessFileId: string }): Promise<boolean>
  deleteFitnessFileRoutesForActor(params: { actorId: string }): Promise<number>
  /**
   * Counts the actor's countable activities whose route intersects `bounds`.
   * Filters with `countableActivity`, the predicate the gear rollups and the
   * fitness overview use, so a region heatmap's activity count can never
   * disagree with the totals shown elsewhere. Activities with no GPS never
   * intersect anything and so are never counted.
   */
  countFitnessFileRoutesIntersecting(params: {
    actorId: string
    bounds: FitnessRouteHeatmapBounds
  }): Promise<number>
  /**
   * The bounding box enclosing the actor's cached routes, or null when none
   * qualify. When `bounds` is given this is the union of the boxes of the
   * routes that INTERSECT it, which can extend beyond it — a route that leaves
   * the rectangle contributes its whole box. Callers that need a box confined
   * to the region intersect this result with the region themselves; keeping the
   * clip out here means the same query answers both the world and region cases.
   */
  getFitnessFileRouteBounds(
    params: FitnessFileRouteBoundsParams
  ): Promise<FitnessRouteHeatmapBounds | null>
}
