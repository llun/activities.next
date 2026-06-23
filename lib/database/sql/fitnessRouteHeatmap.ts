import crypto from 'crypto'
import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  FitnessRouteHeatmap,
  FitnessRouteHeatmapBounds,
  FitnessRouteHeatmapPeriodType,
  FitnessRouteHeatmapRegionName,
  FitnessRouteHeatmapSegment,
  FitnessRouteHeatmapStatus,
  FitnessRouteHeatmapSummary,
  SQLFitnessRouteHeatmap,
  SQLFitnessRouteHeatmapRegionName
} from '@/lib/types/database/fitnessRouteHeatmap'

export interface CreateFitnessRouteHeatmapParams {
  actorId: string
  activityType?: string | null
  periodType: FitnessRouteHeatmapPeriodType
  periodKey: string
  region?: string
  periodStart?: Date | null
  periodEnd?: Date | null
}

export interface GetFitnessRouteHeatmapParams {
  id: string
}

export interface GetFitnessRouteHeatmapByKeyParams {
  actorId: string
  activityType?: string | null
  periodType: FitnessRouteHeatmapPeriodType
  periodKey: string
  region?: string
  includeDeleted?: boolean
}

export interface GetFitnessRouteHeatmapsForActorParams {
  actorId: string
  activityType?: string | null
  periodType?: FitnessRouteHeatmapPeriodType
  region?: string
}

export interface UpdateFitnessRouteHeatmapStatusParams {
  id: string
  status: FitnessRouteHeatmapStatus
  bounds?: FitnessRouteHeatmapBounds | null
  segments?: FitnessRouteHeatmapSegment[] | null
  error?: string | null
  activityCount?: number
  pointCount?: number
  totalCount?: number
  cursorOffset?: number
  isPartial?: boolean
  clearDeleted?: boolean
  clearDeletedBefore?: number
}

export interface GetDistinctActivityTypesParams {
  actorId: string
}

export interface LegacyFitnessHeatmapMediaCleanupPath {
  actorId: string
  imagePath: string
}

export interface FitnessRouteHeatmapDatabase {
  createFitnessRouteHeatmap(
    params: CreateFitnessRouteHeatmapParams
  ): Promise<FitnessRouteHeatmap>
  getFitnessRouteHeatmap(
    params: GetFitnessRouteHeatmapParams
  ): Promise<FitnessRouteHeatmap | null>
  getFitnessRouteHeatmapByKey(
    params: GetFitnessRouteHeatmapByKeyParams
  ): Promise<FitnessRouteHeatmap | null>
  getFitnessRouteHeatmapsForActor(
    params: GetFitnessRouteHeatmapsForActorParams
  ): Promise<FitnessRouteHeatmap[]>
  getFitnessRouteHeatmapSummariesForActor(
    params: GetFitnessRouteHeatmapsForActorParams
  ): Promise<FitnessRouteHeatmapSummary[]>
  updateFitnessRouteHeatmapStatus(
    params: UpdateFitnessRouteHeatmapStatusParams
  ): Promise<boolean>
  /**
   * Soft-deletes a single route heatmap owned by `actorId`. Returns true when a
   * matching, not-already-deleted row was removed. Scoped to the actor so a
   * caller can only remove their own heatmaps.
   */
  deleteFitnessRouteHeatmap(params: {
    actorId: string
    id: string
  }): Promise<boolean>
  getDistinctActivityTypesForActor(
    params: GetDistinctActivityTypesParams
  ): Promise<string[]>
  getDistinctRouteHeatmapRegionsForActor(params: {
    actorId: string
    includeDeleted?: boolean
  }): Promise<string[]>
  /**
   * Returns every saved region label for the actor as `{ region, name }` pairs,
   * keyed by the serialized region cache key. Used to rehydrate region names in
   * the heatmaps UI so a rediscovered region keeps its label.
   */
  getFitnessRouteHeatmapRegionNames(params: {
    actorId: string
  }): Promise<FitnessRouteHeatmapRegionName[]>
  /**
   * Upserts the label for one `(actorId, region)` region. A null/blank name
   * clears the stored label (deletes the row). The world-wide region (empty
   * `region` key) is unnamed and never stored.
   */
  setFitnessRouteHeatmapRegionName(params: {
    actorId: string
    region: string
    name: string | null
  }): Promise<void>
  deleteFitnessRouteHeatmapsForActor(params: {
    actorId: string
  }): Promise<number>
  /**
   * Counts non-deleted route-heatmap rows whose `region` is in the legacy
   * named-region format (neither the world-wide sentinel `''` nor a `rect:`
   * token), for the region-model migration cleanup.
   */
  countLegacyRegionRouteHeatmaps(): Promise<number>
  /**
   * Soft-deletes the legacy named-region route-heatmap rows counted by
   * countLegacyRegionRouteHeatmaps. Returns the number of rows updated.
   */
  softDeleteLegacyRegionRouteHeatmaps(): Promise<number>
  getLegacyFitnessHeatmapMediaCleanupPaths(): Promise<
    LegacyFitnessHeatmapMediaCleanupPath[]
  >
  markLegacyFitnessHeatmapMediaCleanupPath(params: {
    actorId: string
    imagePath: string
    error?: string | null
  }): Promise<boolean>
}

const parseJsonValue = <T>(
  value: string | null | undefined,
  fallback: T
): T => {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const parseBooleanValue = (value: boolean | number | string | null) =>
  value === true || value === 1 || value === '1'

const parseSQLFitnessRouteHeatmap = (
  row: SQLFitnessRouteHeatmap
): FitnessRouteHeatmap => ({
  id: row.id,
  actorId: row.actorId,
  activityType: row.activityType ?? undefined,
  periodType: row.periodType as FitnessRouteHeatmapPeriodType,
  periodKey: row.periodKey,
  region: row.region,
  periodStart: row.periodStart ? getCompatibleTime(row.periodStart) : undefined,
  periodEnd: row.periodEnd ? getCompatibleTime(row.periodEnd) : undefined,
  bounds: parseJsonValue<FitnessRouteHeatmapBounds | undefined>(
    row.bounds,
    undefined
  ),
  segments: parseJsonValue<FitnessRouteHeatmapSegment[]>(row.segments, []),
  status: row.status as FitnessRouteHeatmapStatus,
  error: row.error ?? undefined,
  activityCount: row.activityCount,
  pointCount: row.pointCount,
  totalCount: Number(row.totalCount ?? 0),
  cursorOffset: Number(row.cursorOffset ?? 0),
  isPartial: parseBooleanValue(row.isPartial),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

const parseSQLFitnessRouteHeatmapSummary = (
  row: SQLFitnessRouteHeatmap
): FitnessRouteHeatmapSummary => ({
  id: row.id,
  actorId: row.actorId,
  activityType: row.activityType ?? undefined,
  periodType: row.periodType as FitnessRouteHeatmapPeriodType,
  periodKey: row.periodKey,
  region: row.region,
  periodStart: row.periodStart ? getCompatibleTime(row.periodStart) : undefined,
  periodEnd: row.periodEnd ? getCompatibleTime(row.periodEnd) : undefined,
  status: row.status as FitnessRouteHeatmapStatus,
  error: row.error ?? undefined,
  activityCount: row.activityCount,
  pointCount: row.pointCount,
  totalCount: Number(row.totalCount ?? 0),
  cursorOffset: Number(row.cursorOffset ?? 0),
  isPartial: parseBooleanValue(row.isPartial),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

const getActivityTypeKey = (activityType?: string | null) => activityType ?? ''

const applyRouteHeatmapFilters = (
  query: Knex.QueryBuilder<SQLFitnessRouteHeatmap, SQLFitnessRouteHeatmap[]>,
  {
    activityType,
    periodType,
    region
  }: Pick<
    GetFitnessRouteHeatmapsForActorParams,
    'activityType' | 'periodType' | 'region'
  >
) => {
  if (activityType !== undefined) {
    query.where('activityTypeKey', getActivityTypeKey(activityType))
  }

  if (periodType) {
    query.where('periodType', periodType)
  }

  if (region !== undefined) {
    query.where('region', region)
  }

  return query
}

export const FitnessRouteHeatmapSQLDatabaseMixin = (
  database: Knex
): FitnessRouteHeatmapDatabase => ({
  async createFitnessRouteHeatmap(params: CreateFitnessRouteHeatmapParams) {
    const currentTime = new Date()
    const id = crypto.randomUUID()

    const data: SQLFitnessRouteHeatmap = {
      id,
      actorId: params.actorId,
      activityType: params.activityType ?? null,
      activityTypeKey: getActivityTypeKey(params.activityType),
      periodType: params.periodType,
      periodKey: params.periodKey,
      region: params.region ?? '',
      periodStart: params.periodStart ?? null,
      periodEnd: params.periodEnd ?? null,
      bounds: null,
      segments: null,
      status: 'pending',
      error: null,
      activityCount: 0,
      pointCount: 0,
      totalCount: 0,
      cursorOffset: 0,
      isPartial: false,
      createdAt: currentTime,
      updatedAt: currentTime,
      deletedAt: null
    }

    await database('fitness_route_heatmaps').insert(data)
    return parseSQLFitnessRouteHeatmap(data)
  },

  async getFitnessRouteHeatmap({ id }: GetFitnessRouteHeatmapParams) {
    const row = await database<SQLFitnessRouteHeatmap>('fitness_route_heatmaps')
      .where('id', id)
      .whereNull('deletedAt')
      .first()

    if (!row) return null
    return parseSQLFitnessRouteHeatmap(row)
  },

  async getFitnessRouteHeatmapByKey({
    actorId,
    activityType,
    periodType,
    periodKey,
    region = '',
    includeDeleted
  }: GetFitnessRouteHeatmapByKeyParams) {
    let query = database<SQLFitnessRouteHeatmap>('fitness_route_heatmaps')
      .where('actorId', actorId)
      .where('activityTypeKey', getActivityTypeKey(activityType))
      .where('periodType', periodType)
      .where('periodKey', periodKey)
      .where('region', region)

    if (!includeDeleted) {
      query = query.whereNull('deletedAt')
    }

    const row = await query.first()
    if (!row) return null
    return parseSQLFitnessRouteHeatmap(row)
  },

  async getFitnessRouteHeatmapsForActor({
    actorId,
    activityType,
    periodType,
    region
  }: GetFitnessRouteHeatmapsForActorParams) {
    const query = applyRouteHeatmapFilters(
      database<SQLFitnessRouteHeatmap>('fitness_route_heatmaps')
        .where('actorId', actorId)
        .whereNull('deletedAt'),
      { activityType, periodType, region }
    )

    const rows = await query.orderBy('updatedAt', 'desc').orderBy('id', 'asc')
    return rows.map(parseSQLFitnessRouteHeatmap)
  },

  async getFitnessRouteHeatmapSummariesForActor({
    actorId,
    activityType,
    periodType,
    region
  }: GetFitnessRouteHeatmapsForActorParams) {
    const query = applyRouteHeatmapFilters(
      database<SQLFitnessRouteHeatmap>('fitness_route_heatmaps')
        .where('actorId', actorId)
        .whereNull('deletedAt')
        .select(
          'id',
          'actorId',
          'activityType',
          'activityTypeKey',
          'periodType',
          'periodKey',
          'region',
          'periodStart',
          'periodEnd',
          'status',
          'error',
          'activityCount',
          'pointCount',
          'totalCount',
          'cursorOffset',
          'isPartial',
          'createdAt',
          'updatedAt',
          'deletedAt'
        ),
      { activityType, periodType, region }
    )

    const rows = await query.orderBy('updatedAt', 'desc').orderBy('id', 'asc')
    return rows.map(parseSQLFitnessRouteHeatmapSummary)
  },

  async updateFitnessRouteHeatmapStatus({
    id,
    status,
    bounds,
    segments,
    error,
    activityCount,
    pointCount,
    totalCount,
    cursorOffset,
    isPartial,
    clearDeleted,
    clearDeletedBefore
  }: UpdateFitnessRouteHeatmapStatusParams) {
    const updateData: Record<string, unknown> = {
      status,
      updatedAt: new Date()
    }

    if (bounds !== undefined) {
      updateData.bounds = bounds === null ? null : JSON.stringify(bounds)
    }
    if (segments !== undefined) {
      updateData.segments = segments === null ? null : JSON.stringify(segments)
    }
    if (error !== undefined) {
      updateData.error = error
    }
    if (activityCount !== undefined) {
      updateData.activityCount = activityCount
    }
    if (pointCount !== undefined) {
      updateData.pointCount = pointCount
    }
    if (totalCount !== undefined) {
      updateData.totalCount = totalCount
    }
    if (cursorOffset !== undefined) {
      updateData.cursorOffset = cursorOffset
    }
    if (isPartial !== undefined) {
      updateData.isPartial = isPartial
    }
    if (clearDeleted) {
      updateData.deletedAt = null
    }

    const query = database('fitness_route_heatmaps').where('id', id)
    if (!clearDeleted) {
      query.whereNull('deletedAt')
    } else {
      const clearDeletedCutoff = clearDeletedBefore ?? 0
      query.where((builder) => {
        builder
          .whereNull('deletedAt')
          .orWhere('deletedAt', '<=', new Date(clearDeletedCutoff))
      })
    }
    const result = await query.update(updateData)

    return result > 0
  },

  async getDistinctActivityTypesForActor({
    actorId
  }: GetDistinctActivityTypesParams) {
    const rows = await database('fitness_files')
      .where('actorId', actorId)
      .where('processingStatus', 'completed')
      .where('isPrimary', true)
      .whereNull('deletedAt')
      .whereNotNull('activityType')
      .distinct('activityType')
      .orderBy('activityType', 'asc')

    return rows.map((row: { activityType: string }) => row.activityType)
  },

  async getDistinctRouteHeatmapRegionsForActor({ actorId, includeDeleted }) {
    let query = database('fitness_route_heatmaps')
      .where('actorId', actorId)
      .whereNot('region', '')

    if (!includeDeleted) {
      query = query.whereNull('deletedAt')
    }

    const rows = await query.distinct('region').orderBy('region', 'asc')

    return rows.map((row: { region: string }) => row.region)
  },

  async getFitnessRouteHeatmapRegionNames({ actorId }: { actorId: string }) {
    const rows = await database<SQLFitnessRouteHeatmapRegionName>(
      'fitness_route_heatmap_region_names'
    )
      .where('actorId', actorId)
      .select('region', 'name')
      .orderBy('region', 'asc')

    return rows.map(
      (row): FitnessRouteHeatmapRegionName => ({
        region: row.region,
        name: row.name
      })
    )
  },

  async setFitnessRouteHeatmapRegionName({
    actorId,
    region,
    name
  }: {
    actorId: string
    region: string
    name: string | null
  }) {
    const trimmed = name?.trim() ?? ''
    // A blank name clears the label. The world-wide region (empty key) is never
    // named, so there is nothing to store for it either.
    if (trimmed === '' || region === '') {
      await database('fitness_route_heatmap_region_names')
        .where('actorId', actorId)
        .where('region', region)
        .delete()
      return
    }

    const currentTime = new Date()
    await database('fitness_route_heatmap_region_names')
      .insert({
        actorId,
        region,
        name: trimmed,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict(['actorId', 'region'])
      .merge({ name: trimmed, updatedAt: currentTime })
  },

  async deleteFitnessRouteHeatmapsForActor({ actorId }: { actorId: string }) {
    return database('fitness_route_heatmaps')
      .where('actorId', actorId)
      .whereNull('deletedAt')
      .update({
        deletedAt: new Date(),
        updatedAt: new Date()
      })
  },

  async deleteFitnessRouteHeatmap({
    actorId,
    id
  }: {
    actorId: string
    id: string
  }) {
    const updated = await database('fitness_route_heatmaps')
      .where('id', id)
      .where('actorId', actorId)
      .whereNull('deletedAt')
      .update({
        deletedAt: new Date(),
        updatedAt: new Date()
      })

    return updated > 0
  },

  async countLegacyRegionRouteHeatmaps() {
    const [row] = await database('fitness_route_heatmaps')
      .whereNull('deletedAt')
      .whereNot('region', '')
      .whereNot('region', 'like', 'rect:%')
      .count({ count: '*' })

    return Number(row?.count ?? 0)
  },

  async softDeleteLegacyRegionRouteHeatmaps() {
    return database('fitness_route_heatmaps')
      .whereNull('deletedAt')
      .whereNot('region', '')
      .whereNot('region', 'like', 'rect:%')
      .update({
        deletedAt: new Date(),
        updatedAt: new Date()
      })
  },

  async getLegacyFitnessHeatmapMediaCleanupPaths() {
    const rows = await database('legacy_fitness_heatmap_media_cleanup')
      .whereNull('deletedAt')
      .select('actorId', 'imagePath')
      .orderBy('createdAt', 'asc')

    return rows.map((row: { actorId: string; imagePath: string }) => ({
      actorId: row.actorId,
      imagePath: row.imagePath
    }))
  },

  async markLegacyFitnessHeatmapMediaCleanupPath({
    actorId,
    imagePath,
    error
  }) {
    const updateData =
      error === undefined || error === null
        ? { deletedAt: new Date(), error: null }
        : { error, deletedAt: null }

    const result = await database('legacy_fitness_heatmap_media_cleanup')
      .where('actorId', actorId)
      .where('imagePath', imagePath)
      .update(updateData)

    return result > 0
  }
})
