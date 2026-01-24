import { Knex } from 'knex'

interface FitnessActivity {
  id: string
  actorId: string
  statusId: string | null
  provider: string
  providerId: string
  type: string | null
  name: string | null
  description: string | null
  startDate: Date | null
  endDate: Date | null
  distance: number | null
  movingTime: number | null
  elapsedTime: number | null
  totalElevationGain: number | null
  averageSpeed: number | null
  maxSpeed: number | null
  averageHeartrate: number | null
  maxHeartrate: number | null
  averageWatts: number | null
  maxWatts: number | null
  calories: number | null
  startLatlng: string | null
  endLatlng: string | null
  mapPolyline: string | null
  mapSummaryPolyline: string | null
  photos: string | null
  mediaId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateFitnessActivityParams {
  id: string
  actorId: string
  statusId?: string
  provider: string
  providerId: string
  type?: string
  name?: string
  description?: string
  startDate?: Date
  endDate?: Date
  distance?: number
  movingTime?: number
  elapsedTime?: number
  totalElevationGain?: number
  averageSpeed?: number
  maxSpeed?: number
  averageHeartrate?: number
  maxHeartrate?: number
  averageWatts?: number
  maxWatts?: number
  calories?: number
  startLatlng?: [number, number]
  endLatlng?: [number, number]
  mapPolyline?: string
  mapSummaryPolyline?: string
  photos?: unknown[]
  mediaId?: string
}

export interface GetFitnessActivityParams {
  provider: string
  providerId: string
  actorId: string
}

export interface GetFitnessActivityByStatusIdParams {
  statusId: string
}

export interface FitnessDatabase {
  createFitnessActivity(
    params: CreateFitnessActivityParams
  ): Promise<FitnessActivity>
  getFitnessActivity(
    params: GetFitnessActivityParams
  ): Promise<FitnessActivity | null>
  getFitnessActivityByStatusId(
    params: GetFitnessActivityByStatusIdParams
  ): Promise<FitnessActivity | null>
}

export const FitnessSQLDatabaseMixin = (database: Knex): FitnessDatabase => ({
  async createFitnessActivity(params: CreateFitnessActivityParams) {
    const currentTime = new Date()

    await database('fitness_activities').insert({
      id: params.id,
      actorId: params.actorId,
      statusId: params.statusId || null,
      provider: params.provider,
      providerId: params.providerId,
      type: params.type || null,
      name: params.name || null,
      description: params.description || null,
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      distance: params.distance || null,
      movingTime: params.movingTime || null,
      elapsedTime: params.elapsedTime || null,
      totalElevationGain: params.totalElevationGain || null,
      averageSpeed: params.averageSpeed || null,
      maxSpeed: params.maxSpeed || null,
      averageHeartrate: params.averageHeartrate || null,
      maxHeartrate: params.maxHeartrate || null,
      averageWatts: params.averageWatts || null,
      maxWatts: params.maxWatts || null,
      calories: params.calories || null,
      startLatlng: params.startLatlng
        ? JSON.stringify(params.startLatlng)
        : null,
      endLatlng: params.endLatlng ? JSON.stringify(params.endLatlng) : null,
      mapPolyline: params.mapPolyline || null,
      mapSummaryPolyline: params.mapSummaryPolyline || null,
      photos: params.photos ? JSON.stringify(params.photos) : null,
      mediaId: params.mediaId || null,
      createdAt: currentTime,
      updatedAt: currentTime
    })

    const activity = await database<FitnessActivity>('fitness_activities')
      .where({
        provider: params.provider,
        providerId: params.providerId,
        actorId: params.actorId
      })
      .first()

    if (!activity) {
      throw new Error('Failed to create fitness activity')
    }

    return activity
  },

  async getFitnessActivity(params: GetFitnessActivityParams) {
    const activity = await database<FitnessActivity>('fitness_activities')
      .where({
        provider: params.provider,
        providerId: params.providerId,
        actorId: params.actorId
      })
      .first()

    return activity || null
  },

  async getFitnessActivityByStatusId(
    params: GetFitnessActivityByStatusIdParams
  ) {
    const activity = await database<FitnessActivity>('fitness_activities')
      .where('statusId', params.statusId)
      .first()

    return activity || null
  }
})
