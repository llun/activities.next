import {
  SUMMARY_COLUMNS,
  allActivitiesAllTimeShare,
  getActivityTypeKey,
  pyramidSubscriber,
  toFitnessRouteHeatmap,
  toFitnessRouteHeatmapSummary
} from '@/lib/database/domains/fitnessRouteHeatmap/rows'
import type {
  GetDistinctActivityTypesParams,
  GetFitnessRouteHeatmapByKeyParams,
  GetFitnessRouteHeatmapParams,
  GetFitnessRouteHeatmapsForActorParams
} from '@/lib/database/domains/fitnessRouteHeatmap/types'
import { fitnessRouteHeatmapWrites } from '@/lib/database/domains/fitnessRouteHeatmap/writes'
import type { Db } from '@/lib/database/kysely'
import type {
  FitnessRouteHeatmap,
  FitnessRouteHeatmapRegionName,
  FitnessRouteHeatmapSummary
} from '@/lib/types/database/fitnessRouteHeatmap'

// The route heatmap reads. The writes are in ./writes.ts.

export const getFitnessRouteHeatmap = async (
  db: Db,
  { id }: GetFitnessRouteHeatmapParams
): Promise<FitnessRouteHeatmap | null> => {
  const row = await db
    .selectFrom('fitness_route_heatmaps')
    .selectAll()
    .where('id', '=', id)
    .where('deletedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()

  return row ? toFitnessRouteHeatmap(row) : null
}

export const getFitnessRouteHeatmapByKey = async (
  db: Db,
  {
    actorId,
    activityType,
    periodType,
    periodKey,
    region = '',
    includeDeleted
  }: GetFitnessRouteHeatmapByKeyParams
): Promise<FitnessRouteHeatmap | null> => {
  const row = await db
    .selectFrom('fitness_route_heatmaps')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('activityTypeKey', '=', getActivityTypeKey(activityType))
    .where('periodType', '=', periodType)
    .where('periodKey', '=', periodKey)
    .where('region', '=', region)
    .$if(!includeDeleted, (qb) => qb.where('deletedAt', 'is', null))
    .limit(1)
    .executeTakeFirst()

  return row ? toFitnessRouteHeatmap(row) : null
}

// A live, shared heatmap by its token, in the one scope a share resolves for.
const sharedHeatmap = (db: Db, shareToken: string) =>
  db
    .selectFrom('fitness_route_heatmaps')
    .where('shareToken', '=', shareToken)
    .where('deletedAt', 'is', null)
    .where(allActivitiesAllTimeShare)

export const getFitnessRouteHeatmapByShareToken = async (
  db: Db,
  { shareToken }: { shareToken: string }
): Promise<FitnessRouteHeatmap | null> => {
  if (!shareToken) return null

  const row = await sharedHeatmap(db, shareToken)
    .selectAll()
    .limit(1)
    .executeTakeFirst()

  return row ? toFitnessRouteHeatmap(row) : null
}

export const getFitnessRouteHeatmapSummaryByShareToken = async (
  db: Db,
  { shareToken }: { shareToken: string }
): Promise<FitnessRouteHeatmapSummary | null> => {
  if (!shareToken) return null

  const row = await sharedHeatmap(db, shareToken)
    // Summary columns only — see the interface docblock: the tile routes need
    // the share's scope, never its geometry.
    .select(SUMMARY_COLUMNS)
    .limit(1)
    .executeTakeFirst()

  return row ? toFitnessRouteHeatmapSummary(row) : null
}

export const getFitnessRouteHeatmapSubscribers = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<FitnessRouteHeatmapSummary[]> => {
  const rows = await db
    .selectFrom('fitness_route_heatmaps')
    // Summary columns only. A build calls this on every checkpoint, and
    // `segments` is the whole heatmap payload — selecting it here would drag
    // megabytes off disk each time just to count who is waiting.
    .select(SUMMARY_COLUMNS)
    .where('actorId', '=', actorId)
    .where(pyramidSubscriber)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute()

  return rows.map(toFitnessRouteHeatmapSummary)
}

// The actor's live heatmaps, narrowed by whichever of the filters are given.
const heatmapsForActor = (
  db: Db,
  {
    actorId,
    activityType,
    periodType,
    region
  }: GetFitnessRouteHeatmapsForActorParams
) =>
  db
    .selectFrom('fitness_route_heatmaps')
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .$if(activityType !== undefined, (qb) =>
      qb.where('activityTypeKey', '=', getActivityTypeKey(activityType))
    )
    .$if(Boolean(periodType), (qb) => qb.where('periodType', '=', periodType!))
    .$if(region !== undefined, (qb) => qb.where('region', '=', region!))

export const getFitnessRouteHeatmapsForActor = async (
  db: Db,
  params: GetFitnessRouteHeatmapsForActorParams
): Promise<FitnessRouteHeatmap[]> => {
  const rows = await heatmapsForActor(db, params)
    .selectAll()
    .orderBy('updatedAt', 'desc')
    .orderBy('id', 'asc')
    .execute()

  return rows.map(toFitnessRouteHeatmap)
}

export const getFitnessRouteHeatmapSummariesForActor = async (
  db: Db,
  params: GetFitnessRouteHeatmapsForActorParams
): Promise<FitnessRouteHeatmapSummary[]> => {
  const rows = await heatmapsForActor(db, params)
    .select(SUMMARY_COLUMNS)
    .orderBy('updatedAt', 'desc')
    .orderBy('id', 'asc')
    .execute()

  return rows.map(toFitnessRouteHeatmapSummary)
}

export const getDistinctActivityTypesForActor = async (
  db: Db,
  { actorId }: GetDistinctActivityTypesParams
): Promise<string[]> => {
  const rows = await db
    .selectFrom('fitness_files')
    .select('activityType')
    .distinct()
    .where('actorId', '=', actorId)
    .where('processingStatus', '=', 'completed')
    .where('isPrimary', '=', true)
    .where('deletedAt', 'is', null)
    .where('activityType', 'is not', null)
    .orderBy('activityType', 'asc')
    .execute()

  return rows.map((row) => row.activityType as string)
}

export const getDistinctRouteHeatmapRegionsForActor = async (
  db: Db,
  { actorId, includeDeleted }: { actorId: string; includeDeleted?: boolean }
): Promise<string[]> => {
  const rows = await db
    .selectFrom('fitness_route_heatmaps')
    .select('region')
    .distinct()
    .where('actorId', '=', actorId)
    .where('region', '<>', '')
    .$if(!includeDeleted, (qb) => qb.where('deletedAt', 'is', null))
    .orderBy('region', 'asc')
    .execute()

  return rows.map((row) => row.region)
}

export const getFitnessRouteHeatmapRegionNames = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<FitnessRouteHeatmapRegionName[]> => {
  const rows = await db
    .selectFrom('fitness_route_heatmap_region_names')
    .select(['region', 'name'])
    .where('actorId', '=', actorId)
    .orderBy('region', 'asc')
    .execute()

  return rows.map((row): FitnessRouteHeatmapRegionName => ({
    region: row.region,
    name: row.name
  }))
}

// The facade getSQLDatabase binds with bindDb(): the reads here and the writes
// in ./writes.ts.
export const fitnessRouteHeatmapQueries = {
  getFitnessRouteHeatmap,
  getFitnessRouteHeatmapByKey,
  getFitnessRouteHeatmapByShareToken,
  getFitnessRouteHeatmapSummaryByShareToken,
  getFitnessRouteHeatmapSubscribers,
  getFitnessRouteHeatmapsForActor,
  getFitnessRouteHeatmapSummariesForActor,
  getDistinctActivityTypesForActor,
  getDistinctRouteHeatmapRegionsForActor,
  getFitnessRouteHeatmapRegionNames,
  ...fitnessRouteHeatmapWrites
}
