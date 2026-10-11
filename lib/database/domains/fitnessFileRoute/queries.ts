import {
  calculateRouteBounds,
  parseRouteBounds,
  toFitnessFileRoute
} from '@/lib/database/domains/fitnessFileRoute/rows'
import type {
  FitnessFileRouteBoundsParams,
  UpsertFitnessFileRouteParams
} from '@/lib/database/domains/fitnessFileRoute/types'
import type { Db } from '@/lib/database/kysely'
import { countableActivity } from '@/lib/database/kysely/countableActivity'
import { selectInChunks } from '@/lib/database/kysely/inList'
import type { FitnessFileRoute } from '@/lib/types/database/fitnessFileRoute'
import type { FitnessRouteHeatmapBounds } from '@/lib/types/database/fitnessRouteHeatmap'

// The cached routes of fitness activities (`fitness_file_routes`): one row per
// activity, written by the heatmap and processing jobs and read back by the
// heatmap build, plus the two aggregates a region heatmap needs.

export const upsertFitnessFileRoute = async (
  db: Db,
  {
    fitnessFileId,
    actorId,
    points,
    sourceVersion
  }: UpsertFitnessFileRouteParams
): Promise<void> => {
  const currentTime = new Date()
  const bounds = calculateRouteBounds(points)

  await db
    .insertInto('fitness_file_routes')
    .values({
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
    .onConflict((conflict) =>
      conflict.column('fitnessFileId').doUpdateSet({
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
    )
    .execute()
}

export const getFitnessFileRoutes = async (
  db: Db,
  { fitnessFileIds }: { fitnessFileIds: string[] }
): Promise<FitnessFileRoute[]> => {
  const uniqueIds = [...new Set(fitnessFileIds)]
  if (uniqueIds.length === 0) return []

  const rows = await selectInChunks(db, uniqueIds, (chunk) =>
    db
      .selectFrom('fitness_file_routes')
      .selectAll()
      .where('fitnessFileId', 'in', chunk)
      .execute()
  )
  return rows.map(toFitnessFileRoute)
}

export const deleteFitnessFileRoute = async (
  db: Db,
  { fitnessFileId }: { fitnessFileId: string }
): Promise<boolean> => {
  const result = await db
    .deleteFrom('fitness_file_routes')
    .where('fitnessFileId', '=', fitnessFileId)
    .executeTakeFirst()
  return Number(result.numDeletedRows) > 0
}

export const deleteFitnessFileRoutesForActor = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<number> => {
  const result = await db
    .deleteFrom('fitness_file_routes')
    .where('actorId', '=', actorId)
    .executeTakeFirst()
  return Number(result.numDeletedRows)
}

/**
 * Joins the cached routes to their owning activity and applies the shared
 * countable-activity predicate, so every aggregate over this table counts the
 * same activities the fitness overview does. `minLat is not null` drops the
 * GPS-less negative-cache rows, which have no box to compare against.
 */
const boundedRoutes = (
  db: Db,
  actorId: string,
  bounds?: FitnessRouteHeatmapBounds
) =>
  db
    .selectFrom('fitness_file_routes')
    .innerJoin(
      'fitness_files',
      'fitness_files.id',
      'fitness_file_routes.fitnessFileId'
    )
    .where((eb) => countableActivity(eb))
    .where('fitness_file_routes.actorId', '=', actorId)
    .where('fitness_file_routes.minLat', 'is not', null)
    // Axis-aligned box overlap, written as "the boxes are not disjoint" so it
    // stays four simple comparisons the (actorId, minLat, maxLat) index can
    // help with. Touching edges count as intersecting.
    .$if(Boolean(bounds), (qb) =>
      qb
        .where('fitness_file_routes.minLat', '<=', bounds!.maxLat)
        .where('fitness_file_routes.maxLat', '>=', bounds!.minLat)
        .where('fitness_file_routes.minLng', '<=', bounds!.maxLng)
        .where('fitness_file_routes.maxLng', '>=', bounds!.minLng)
    )

export const countFitnessFileRoutesIntersecting = async (
  db: Db,
  { actorId, bounds }: { actorId: string; bounds: FitnessRouteHeatmapBounds }
): Promise<number> => {
  const row = await boundedRoutes(db, actorId, bounds)
    .select((eb) => eb.fn.countAll().as('count'))
    .executeTakeFirst()

  // An aggregate has no declared type on SQLite, so it is converted here.
  return Number(row?.count ?? 0)
}

export const getFitnessFileRouteBounds = async (
  db: Db,
  { actorId, bounds }: FitnessFileRouteBoundsParams
): Promise<FitnessRouteHeatmapBounds | null> => {
  const row = await boundedRoutes(db, actorId, bounds)
    .select((eb) => [
      eb.fn.min('fitness_file_routes.minLat').as('minLat'),
      eb.fn.max('fitness_file_routes.maxLat').as('maxLat'),
      eb.fn.min('fitness_file_routes.minLng').as('minLng'),
      eb.fn.max('fitness_file_routes.maxLng').as('maxLng')
    ])
    .limit(1)
    .executeTakeFirst()

  if (!row) return null

  // The aggregates come back null when no row matched; MIN/MAX over an empty
  // set is null rather than no row at all, so this is the empty case.
  return parseRouteBounds(row) ?? null
}

// The facade getSQLDatabase binds with bindDb().
export const fitnessFileRouteQueries = {
  upsertFitnessFileRoute,
  getFitnessFileRoutes,
  deleteFitnessFileRoute,
  deleteFitnessFileRoutesForActor,
  countFitnessFileRoutesIntersecting,
  getFitnessFileRouteBounds
}
