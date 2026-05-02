import crypto from 'crypto'
import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  FitnessRouteHeatmap,
  FitnessRouteHeatmapBounds,
  FitnessRouteHeatmapPeriodType,
  FitnessRouteHeatmapSegment,
  FitnessRouteHeatmapStatus,
  SQLFitnessRouteHeatmap
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
  clearDeleted?: boolean
}

export interface GetDistinctActivityTypesParams {
  actorId: string
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
  updateFitnessRouteHeatmapStatus(
    params: UpdateFitnessRouteHeatmapStatusParams
  ): Promise<boolean>
  getDistinctActivityTypesForActor(
    params: GetDistinctActivityTypesParams
  ): Promise<string[]>
  deleteFitnessRouteHeatmapsForActor(params: {
    actorId: string
  }): Promise<number>
  getLegacyFitnessHeatmapMediaCleanupPaths(): Promise<string[]>
  markLegacyFitnessHeatmapMediaCleanupPath(params: {
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
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

const getActivityTypeKey = (activityType?: string | null) => activityType ?? ''

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
    let query = database<SQLFitnessRouteHeatmap>('fitness_route_heatmaps')
      .where('actorId', actorId)
      .whereNull('deletedAt')

    if (activityType !== undefined) {
      query = query.where('activityTypeKey', getActivityTypeKey(activityType))
    }

    if (periodType) {
      query = query.where('periodType', periodType)
    }

    if (region !== undefined) {
      query = query.where('region', region)
    }

    const rows = await query.orderBy('updatedAt', 'desc').orderBy('id', 'asc')
    return rows.map(parseSQLFitnessRouteHeatmap)
  },

  async updateFitnessRouteHeatmapStatus({
    id,
    status,
    bounds,
    segments,
    error,
    activityCount,
    pointCount,
    clearDeleted
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
    if (clearDeleted) {
      updateData.deletedAt = null
    }

    const query = database('fitness_route_heatmaps').where('id', id)
    if (!clearDeleted) {
      query.whereNull('deletedAt')
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

  async deleteFitnessRouteHeatmapsForActor({ actorId }: { actorId: string }) {
    return database('fitness_route_heatmaps')
      .where('actorId', actorId)
      .whereNull('deletedAt')
      .update({
        deletedAt: new Date(),
        updatedAt: new Date()
      })
  },

  async getLegacyFitnessHeatmapMediaCleanupPaths() {
    const rows = await database('legacy_fitness_heatmap_media_cleanup')
      .whereNull('deletedAt')
      .select('imagePath')
      .orderBy('createdAt', 'asc')

    return rows.map((row: { imagePath: string }) => row.imagePath)
  },

  async markLegacyFitnessHeatmapMediaCleanupPath({ imagePath, error }) {
    const updateData =
      error === undefined || error === null
        ? { deletedAt: new Date(), error: null }
        : { error, deletedAt: null }

    const result = await database('legacy_fitness_heatmap_media_cleanup')
      .where('imagePath', imagePath)
      .update(updateData)

    return result > 0
  }
})
