import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateFitnessActivityParams,
  FitnessActivity,
  LatLng,
  UpdateFitnessActivityParams
} from '@/lib/types/domain/fitnessActivity'

interface SQLFitnessActivity {
  id: string
  actorId: string
  stravaActivityId: string // bigint stored as string
  statusId: string | null
  name: string
  type: string
  sportType: string | null
  startDate: Date
  timezone: string | null
  distance: number | null
  movingTime: number | null
  elapsedTime: number | null
  totalElevationGain: number | null
  averageSpeed: number | null
  maxSpeed: number | null
  averageHeartrate: number | null
  maxHeartrate: number | null
  averageCadence: number | null
  averageWatts: number | null
  kilojoules: number | null
  calories: number | null
  startLatlng: string | null // JSONB stored as string
  endLatlng: string | null
  summaryPolyline: string | null
  mapAttachmentId: string | null
  rawData: string | null
  createdAt: Date
  updatedAt: Date
}

export interface GetFitnessActivityParams {
  id: string
}

export interface GetFitnessActivityByStravaIdParams {
  actorId: string
  stravaActivityId: number
}

export interface GetFitnessActivitiesByActorParams {
  actorId: string
  limit?: number
  offset?: number
}

export interface DeleteFitnessActivityParams {
  id: string
}

export interface FitnessActivityDatabase {
  createFitnessActivity: (
    params: CreateFitnessActivityParams
  ) => Promise<FitnessActivity>
  updateFitnessActivity: (
    id: string,
    params: UpdateFitnessActivityParams
  ) => Promise<FitnessActivity | null>
  getFitnessActivity: (
    params: GetFitnessActivityParams
  ) => Promise<FitnessActivity | null>
  getFitnessActivityByStravaId: (
    params: GetFitnessActivityByStravaIdParams
  ) => Promise<FitnessActivity | null>
  getFitnessActivitiesByActor: (
    params: GetFitnessActivitiesByActorParams
  ) => Promise<FitnessActivity[]>
  deleteFitnessActivity: (params: DeleteFitnessActivityParams) => Promise<void>
}

function parseLatLng(value: string | null): LatLng | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.length === 2) {
      return parsed as LatLng
    }
    return null
  } catch {
    return null
  }
}

function rowToFitnessActivity(row: SQLFitnessActivity): FitnessActivity {
  return {
    id: row.id,
    actorId: row.actorId,
    stravaActivityId: parseInt(row.stravaActivityId, 10),
    statusId: row.statusId,
    name: row.name,
    type: row.type,
    sportType: row.sportType,
    startDate: new Date(getCompatibleTime(row.startDate)),
    timezone: row.timezone,
    distance: row.distance,
    movingTime: row.movingTime,
    elapsedTime: row.elapsedTime,
    totalElevationGain: row.totalElevationGain,
    averageSpeed: row.averageSpeed,
    maxSpeed: row.maxSpeed,
    averageHeartrate: row.averageHeartrate,
    maxHeartrate: row.maxHeartrate,
    averageCadence: row.averageCadence,
    averageWatts: row.averageWatts,
    kilojoules: row.kilojoules,
    calories: row.calories,
    startLatlng: parseLatLng(row.startLatlng),
    endLatlng: parseLatLng(row.endLatlng),
    summaryPolyline: row.summaryPolyline,
    mapAttachmentId: row.mapAttachmentId,
    createdAt: new Date(getCompatibleTime(row.createdAt)),
    updatedAt: new Date(getCompatibleTime(row.updatedAt))
  }
}

export const FitnessActivitySQLDatabaseMixin = (
  database: Knex
): FitnessActivityDatabase => ({
  async createFitnessActivity(
    params: CreateFitnessActivityParams
  ): Promise<FitnessActivity> {
    const currentTime = new Date()

    const row: Partial<SQLFitnessActivity> = {
      id: params.id,
      actorId: params.actorId,
      stravaActivityId: params.stravaActivityId.toString(),
      statusId: params.statusId ?? null,
      name: params.name,
      type: params.type,
      sportType: params.sportType ?? null,
      startDate: params.startDate,
      timezone: params.timezone ?? null,
      distance: params.distance ?? null,
      movingTime: params.movingTime ?? null,
      elapsedTime: params.elapsedTime ?? null,
      totalElevationGain: params.totalElevationGain ?? null,
      averageSpeed: params.averageSpeed ?? null,
      maxSpeed: params.maxSpeed ?? null,
      averageHeartrate: params.averageHeartrate ?? null,
      maxHeartrate: params.maxHeartrate ?? null,
      averageCadence: params.averageCadence ?? null,
      averageWatts: params.averageWatts ?? null,
      kilojoules: params.kilojoules ?? null,
      calories: params.calories ?? null,
      startLatlng: params.startLatlng
        ? JSON.stringify(params.startLatlng)
        : null,
      endLatlng: params.endLatlng ? JSON.stringify(params.endLatlng) : null,
      summaryPolyline: params.summaryPolyline ?? null,
      mapAttachmentId: params.mapAttachmentId ?? null,
      rawData: params.rawData ? JSON.stringify(params.rawData) : null,
      createdAt: currentTime,
      updatedAt: currentTime
    }

    await database('fitness_activities').insert(row)

    return {
      id: params.id,
      actorId: params.actorId,
      stravaActivityId: params.stravaActivityId,
      statusId: params.statusId ?? null,
      name: params.name,
      type: params.type,
      sportType: params.sportType ?? null,
      startDate: params.startDate,
      timezone: params.timezone ?? null,
      distance: params.distance ?? null,
      movingTime: params.movingTime ?? null,
      elapsedTime: params.elapsedTime ?? null,
      totalElevationGain: params.totalElevationGain ?? null,
      averageSpeed: params.averageSpeed ?? null,
      maxSpeed: params.maxSpeed ?? null,
      averageHeartrate: params.averageHeartrate ?? null,
      maxHeartrate: params.maxHeartrate ?? null,
      averageCadence: params.averageCadence ?? null,
      averageWatts: params.averageWatts ?? null,
      kilojoules: params.kilojoules ?? null,
      calories: params.calories ?? null,
      startLatlng: params.startLatlng ?? null,
      endLatlng: params.endLatlng ?? null,
      summaryPolyline: params.summaryPolyline ?? null,
      mapAttachmentId: params.mapAttachmentId ?? null,
      createdAt: currentTime,
      updatedAt: currentTime
    }
  },

  async updateFitnessActivity(
    id: string,
    params: UpdateFitnessActivityParams
  ): Promise<FitnessActivity | null> {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date()
    }

    if (params.statusId !== undefined)
      updateData.statusId = params.statusId ?? null
    if (params.name !== undefined) updateData.name = params.name
    if (params.type !== undefined) updateData.type = params.type
    if (params.sportType !== undefined)
      updateData.sportType = params.sportType ?? null
    if (params.distance !== undefined)
      updateData.distance = params.distance ?? null
    if (params.movingTime !== undefined)
      updateData.movingTime = params.movingTime ?? null
    if (params.elapsedTime !== undefined)
      updateData.elapsedTime = params.elapsedTime ?? null
    if (params.totalElevationGain !== undefined)
      updateData.totalElevationGain = params.totalElevationGain ?? null
    if (params.averageSpeed !== undefined)
      updateData.averageSpeed = params.averageSpeed ?? null
    if (params.maxSpeed !== undefined)
      updateData.maxSpeed = params.maxSpeed ?? null
    if (params.averageHeartrate !== undefined)
      updateData.averageHeartrate = params.averageHeartrate ?? null
    if (params.maxHeartrate !== undefined)
      updateData.maxHeartrate = params.maxHeartrate ?? null
    if (params.averageCadence !== undefined)
      updateData.averageCadence = params.averageCadence ?? null
    if (params.averageWatts !== undefined)
      updateData.averageWatts = params.averageWatts ?? null
    if (params.kilojoules !== undefined)
      updateData.kilojoules = params.kilojoules ?? null
    if (params.calories !== undefined)
      updateData.calories = params.calories ?? null
    if (params.startLatlng !== undefined)
      updateData.startLatlng = params.startLatlng
        ? JSON.stringify(params.startLatlng)
        : null
    if (params.endLatlng !== undefined)
      updateData.endLatlng = params.endLatlng
        ? JSON.stringify(params.endLatlng)
        : null
    if (params.summaryPolyline !== undefined)
      updateData.summaryPolyline = params.summaryPolyline ?? null
    if (params.mapAttachmentId !== undefined)
      updateData.mapAttachmentId = params.mapAttachmentId ?? null
    if (params.rawData !== undefined)
      updateData.rawData = params.rawData
        ? JSON.stringify(params.rawData)
        : null

    await database('fitness_activities').where({ id }).update(updateData)

    const row = await database('fitness_activities')
      .where({ id })
      .first<SQLFitnessActivity>()

    if (!row) return null

    return rowToFitnessActivity(row)
  },

  async getFitnessActivity({
    id
  }: GetFitnessActivityParams): Promise<FitnessActivity | null> {
    const row = await database('fitness_activities')
      .where({ id })
      .first<SQLFitnessActivity>()

    if (!row) return null

    return rowToFitnessActivity(row)
  },

  async getFitnessActivityByStravaId({
    actorId,
    stravaActivityId
  }: GetFitnessActivityByStravaIdParams): Promise<FitnessActivity | null> {
    const row = await database('fitness_activities')
      .where({ actorId, stravaActivityId: stravaActivityId.toString() })
      .first<SQLFitnessActivity>()

    if (!row) return null

    return rowToFitnessActivity(row)
  },

  async getFitnessActivitiesByActor({
    actorId,
    limit = 20,
    offset = 0
  }: GetFitnessActivitiesByActorParams): Promise<FitnessActivity[]> {
    const rows = await database('fitness_activities')
      .where({ actorId })
      .orderBy('startDate', 'desc')
      .limit(limit)
      .offset(offset)

    return rows.map(rowToFitnessActivity)
  },

  async deleteFitnessActivity({
    id
  }: DeleteFitnessActivityParams): Promise<void> {
    await database('fitness_activities').where({ id }).delete()
  }
})
