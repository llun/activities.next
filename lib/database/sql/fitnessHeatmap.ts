import crypto from 'crypto'
import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  FitnessHeatmap,
  FitnessHeatmapPeriodType,
  FitnessHeatmapStatus,
  SQLFitnessHeatmap
} from '@/lib/types/database/fitnessHeatmap'

export interface CreateFitnessHeatmapParams {
  actorId: string
  activityType?: string | null
  periodType: FitnessHeatmapPeriodType
  periodKey: string
  /**
   * Serialized sorted comma-separated region IDs, e.g. "netherlands,singapore".
   * Empty string '' (default) means world-wide (no region filter).
   */
  region?: string
  periodStart?: Date | null
  periodEnd?: Date | null
}

export interface GetFitnessHeatmapParams {
  id: string
}

export interface GetFitnessHeatmapByKeyParams {
  actorId: string
  activityType?: string | null
  periodType: FitnessHeatmapPeriodType
  periodKey: string
  /**
   * Serialized sorted comma-separated region IDs.
   * Empty string '' or omitted means world-wide.
   */
  region?: string
  includeDeleted?: boolean
}

export interface GetFitnessHeatmapsForActorParams {
  actorId: string
  activityType?: string | null
  periodType?: FitnessHeatmapPeriodType
  /**
   * When provided, filters to this region value.
   * Pass '' for world-wide heatmaps, leave undefined to get all regions.
   */
  region?: string
}

export interface UpdateFitnessHeatmapStatusParams {
  id: string
  status: FitnessHeatmapStatus
  imagePath?: string | null
  error?: string | null
  activityCount?: number
  clearDeleted?: boolean
}

export interface GetDistinctActivityTypesParams {
  actorId: string
}

export interface FitnessHeatmapDatabase {
  createFitnessHeatmap(
    params: CreateFitnessHeatmapParams
  ): Promise<FitnessHeatmap>
  getFitnessHeatmap(
    params: GetFitnessHeatmapParams
  ): Promise<FitnessHeatmap | null>
  getFitnessHeatmapByKey(
    params: GetFitnessHeatmapByKeyParams
  ): Promise<FitnessHeatmap | null>
  getFitnessHeatmapsForActor(
    params: GetFitnessHeatmapsForActorParams
  ): Promise<FitnessHeatmap[]>
  updateFitnessHeatmapStatus(
    params: UpdateFitnessHeatmapStatusParams
  ): Promise<boolean>
  getDistinctActivityTypesForActor(
    params: GetDistinctActivityTypesParams
  ): Promise<string[]>
  deleteFitnessHeatmapsForActor(params: { actorId: string }): Promise<number>
}

const parseSQLFitnessHeatmap = (row: SQLFitnessHeatmap): FitnessHeatmap => ({
  id: row.id,
  actorId: row.actorId,
  activityType: row.activityType ?? undefined,
  periodType: row.periodType as FitnessHeatmapPeriodType,
  periodKey: row.periodKey,
  region: row.region,
  periodStart: row.periodStart ? getCompatibleTime(row.periodStart) : undefined,
  periodEnd: row.periodEnd ? getCompatibleTime(row.periodEnd) : undefined,
  imagePath: row.imagePath ?? undefined,
  status: row.status as FitnessHeatmapStatus,
  error: row.error ?? undefined,
  activityCount: row.activityCount,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

export const FitnessHeatmapSQLDatabaseMixin = (
  database: Knex
): FitnessHeatmapDatabase => ({
  async createFitnessHeatmap(params: CreateFitnessHeatmapParams) {
    const currentTime = new Date()
    const id = crypto.randomUUID()

    const data: SQLFitnessHeatmap = {
      id,
      actorId: params.actorId,
      activityType: params.activityType ?? null,
      periodType: params.periodType,
      periodKey: params.periodKey,
      region: params.region ?? '',
      periodStart: params.periodStart ?? null,
      periodEnd: params.periodEnd ?? null,
      imagePath: null,
      status: 'pending',
      error: null,
      activityCount: 0,
      createdAt: currentTime,
      updatedAt: currentTime,
      deletedAt: null
    }

    await database('fitness_heatmaps').insert(data)
    return parseSQLFitnessHeatmap(data)
  },

  async getFitnessHeatmap({ id }: GetFitnessHeatmapParams) {
    const row = await database<SQLFitnessHeatmap>('fitness_heatmaps')
      .where('id', id)
      .whereNull('deletedAt')
      .first()

    if (!row) return null
    return parseSQLFitnessHeatmap(row)
  },

  async getFitnessHeatmapByKey({
    actorId,
    activityType,
    periodType,
    periodKey,
    region = '',
    includeDeleted
  }: GetFitnessHeatmapByKeyParams) {
    let query = database<SQLFitnessHeatmap>('fitness_heatmaps')
      .where('actorId', actorId)
      .where('periodType', periodType)
      .where('periodKey', periodKey)
      .where('region', region)

    if (!includeDeleted) {
      query = query.whereNull('deletedAt')
    }

    if (activityType) {
      query = query.where('activityType', activityType)
    } else {
      query = query.whereNull('activityType')
    }

    const row = await query.first()
    if (!row) return null
    return parseSQLFitnessHeatmap(row)
  },

  async getFitnessHeatmapsForActor({
    actorId,
    activityType,
    periodType,
    region
  }: GetFitnessHeatmapsForActorParams) {
    let query = database<SQLFitnessHeatmap>('fitness_heatmaps')
      .where('actorId', actorId)
      .whereNull('deletedAt')

    if (activityType !== undefined) {
      if (activityType) {
        query = query.where('activityType', activityType)
      } else {
        query = query.whereNull('activityType')
      }
    }

    if (periodType) {
      query = query.where('periodType', periodType)
    }

    if (region !== undefined) {
      query = query.where('region', region)
    }

    const rows = await query.orderBy('periodKey', 'desc')
    return rows.map(parseSQLFitnessHeatmap)
  },

  async updateFitnessHeatmapStatus({
    id,
    status,
    imagePath,
    error,
    activityCount,
    clearDeleted
  }: UpdateFitnessHeatmapStatusParams) {
    const updateData: Record<string, unknown> = {
      status,
      updatedAt: new Date()
    }

    if (imagePath !== undefined) {
      updateData.imagePath = imagePath
    }
    if (error !== undefined) {
      updateData.error = error
    }
    if (activityCount !== undefined) {
      updateData.activityCount = activityCount
    }
    if (clearDeleted) {
      updateData.deletedAt = null
    }

    const query = database('fitness_heatmaps').where('id', id)
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

  async deleteFitnessHeatmapsForActor({ actorId }: { actorId: string }) {
    return database('fitness_heatmaps')
      .where('actorId', actorId)
      .whereNull('deletedAt')
      .update({
        deletedAt: new Date(),
        updatedAt: new Date()
      })
  }
})
