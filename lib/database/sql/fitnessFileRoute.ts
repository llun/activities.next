import { Knex } from 'knex'

import { applyCountableActivityFilter } from '@/lib/database/sql/utils/countableActivity'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/sql/utils/knex'
import {
  FitnessFileRoute,
  FitnessFileRoutePoint,
  SQLFitnessFileRoute
} from '@/lib/types/database/fitnessFileRoute'
import { FitnessRouteHeatmapBounds } from '@/lib/types/database/fitnessRouteHeatmap'

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
   * Shares `applyCountableActivityFilter` with the gear rollups and the fitness
   * overview, so a region heatmap's activity count can never disagree with the
   * totals shown elsewhere. Activities with no GPS never intersect anything and
   * so are never counted.
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

const parseCoordinate = (value: number | string | null): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const parseRouteBounds = (
  row: SQLFitnessFileRoute
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

const parseSQLFitnessFileRoute = (
  row: SQLFitnessFileRoute
): FitnessFileRoute => {
  const points = parseRoutePoints(row.points)
  return {
    fitnessFileId: row.fitnessFileId,
    actorId: row.actorId,
    points,
    pointCount: Number(row.pointCount ?? points.length),
    bounds: parseRouteBounds(row),
    sourceVersion: Number(row.sourceVersion ?? 0),
    createdAt: getCompatibleTime(row.createdAt),
    updatedAt: getCompatibleTime(row.updatedAt)
  }
}

const calculateRouteBounds = (
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

/**
 * Joins the cached routes to their owning activity and applies the shared
 * countable-activity predicate, so every aggregate over this table counts the
 * same activities the fitness overview does. `whereNotNull('minLat')` drops the
 * GPS-less negative-cache rows, which have no box to compare against.
 */
const applyBoundedRouteFilter = (
  database: Knex,
  actorId: string,
  bounds?: FitnessRouteHeatmapBounds
) => {
  const query = applyCountableActivityFilter(
    database,
    database('fitness_file_routes').join(
      'fitness_files',
      'fitness_files.id',
      'fitness_file_routes.fitnessFileId'
    ),
    'fitness_files'
  )
    .where('fitness_file_routes.actorId', actorId)
    .whereNotNull('fitness_file_routes.minLat')

  if (!bounds) return query

  // Axis-aligned box overlap, written as "the boxes are not disjoint" so it
  // stays four simple comparisons the (actorId, minLat, maxLat) index can help
  // with. Touching edges count as intersecting.
  return query
    .where('fitness_file_routes.minLat', '<=', bounds.maxLat)
    .where('fitness_file_routes.maxLat', '>=', bounds.minLat)
    .where('fitness_file_routes.minLng', '<=', bounds.maxLng)
    .where('fitness_file_routes.maxLng', '>=', bounds.minLng)
}

export const FitnessFileRouteSQLDatabaseMixin = (
  database: Knex
): FitnessFileRouteDatabase => ({
  async upsertFitnessFileRoute({
    fitnessFileId,
    actorId,
    points,
    sourceVersion
  }: UpsertFitnessFileRouteParams) {
    const currentTime = new Date()
    const bounds = calculateRouteBounds(points)

    await database('fitness_file_routes')
      .insert({
        fitnessFileId,
        actorId,
        points: JSON.stringify(points),
        pointCount: points.length,
        minLat: bounds?.minLat ?? null,
        maxLat: bounds?.maxLat ?? null,
        minLng: bounds?.minLng ?? null,
        maxLng: bounds?.maxLng ?? null,
        sourceVersion,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict('fitnessFileId')
      .merge({
        actorId,
        points: JSON.stringify(points),
        pointCount: points.length,
        minLat: bounds?.minLat ?? null,
        maxLat: bounds?.maxLat ?? null,
        minLng: bounds?.minLng ?? null,
        maxLng: bounds?.maxLng ?? null,
        sourceVersion,
        updatedAt: currentTime
      })
  },

  async getFitnessFileRoutes({ fitnessFileIds }: { fitnessFileIds: string[] }) {
    const uniqueIds = [...new Set(fitnessFileIds)]
    if (uniqueIds.length === 0) return []

    const routes: FitnessFileRoute[] = []
    for (const chunk of chunkArray(uniqueIds, getWhereInBatchSize(database))) {
      const rows = await database<SQLFitnessFileRoute>('fitness_file_routes')
        .whereIn('fitnessFileId', chunk)
        .select('*')
      routes.push(...rows.map(parseSQLFitnessFileRoute))
    }

    return routes
  },

  async deleteFitnessFileRoute({ fitnessFileId }: { fitnessFileId: string }) {
    const deleted = await database('fitness_file_routes')
      .where('fitnessFileId', fitnessFileId)
      .delete()
    return deleted > 0
  },

  async deleteFitnessFileRoutesForActor({ actorId }: { actorId: string }) {
    return database('fitness_file_routes').where('actorId', actorId).delete()
  },

  async countFitnessFileRoutesIntersecting({
    actorId,
    bounds
  }: {
    actorId: string
    bounds: FitnessRouteHeatmapBounds
  }) {
    const [row] = await applyBoundedRouteFilter(
      database,
      actorId,
      bounds
    ).count<{ count: string | number }[]>({
      count: '*'
    })

    return Number(row?.count ?? 0)
  },

  async getFitnessFileRouteBounds({
    actorId,
    bounds
  }: FitnessFileRouteBoundsParams) {
    const [row] = await applyBoundedRouteFilter(database, actorId, bounds)
      .select(
        database.raw('MIN(??) as ??', ['fitness_file_routes.minLat', 'minLat']),
        database.raw('MAX(??) as ??', ['fitness_file_routes.maxLat', 'maxLat']),
        database.raw('MIN(??) as ??', ['fitness_file_routes.minLng', 'minLng']),
        database.raw('MAX(??) as ??', ['fitness_file_routes.maxLng', 'maxLng'])
      )
      .limit(1)

    if (!row) return null

    // The aggregates come back null when no row matched; MIN/MAX over an empty
    // set is null rather than no row at all, so this is the empty case.
    return parseRouteBounds(row as SQLFitnessFileRoute) ?? null
  }
})
