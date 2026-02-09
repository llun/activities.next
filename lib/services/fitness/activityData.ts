import { FitnessActivity } from '@/lib/types/domain/fitnessActivity'

export interface StatusActivityData {
  id: string
  actorId: string
  stravaActivityId: number
  statusId: string | null
  stravaUrl: string
  name: string
  type: string
  sportType: string | null
  startDate: number
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
  startLatlng: [number, number] | null
  endLatlng: [number, number] | null
  summaryPolyline: string | null
  mapAttachmentId: string | null
  createdAt: number
  updatedAt: number
}

export const toStatusActivityData = (
  activity: FitnessActivity
): StatusActivityData => ({
  id: activity.id,
  actorId: activity.actorId,
  stravaActivityId: activity.stravaActivityId,
  statusId: activity.statusId ?? null,
  stravaUrl: `https://www.strava.com/activities/${activity.stravaActivityId}`,
  name: activity.name,
  type: activity.type,
  sportType: activity.sportType ?? null,
  startDate: activity.startDate.getTime(),
  timezone: activity.timezone ?? null,
  distance: activity.distance ?? null,
  movingTime: activity.movingTime ?? null,
  elapsedTime: activity.elapsedTime ?? null,
  totalElevationGain: activity.totalElevationGain ?? null,
  averageSpeed: activity.averageSpeed ?? null,
  maxSpeed: activity.maxSpeed ?? null,
  averageHeartrate: activity.averageHeartrate ?? null,
  maxHeartrate: activity.maxHeartrate ?? null,
  averageCadence: activity.averageCadence ?? null,
  averageWatts: activity.averageWatts ?? null,
  kilojoules: activity.kilojoules ?? null,
  calories: activity.calories ?? null,
  startLatlng: activity.startLatlng ?? null,
  endLatlng: activity.endLatlng ?? null,
  summaryPolyline: activity.summaryPolyline ?? null,
  mapAttachmentId: activity.mapAttachmentId ?? null,
  createdAt: activity.createdAt.getTime(),
  updatedAt: activity.updatedAt.getTime()
})
