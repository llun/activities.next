import { z } from 'zod'

// Strava activity types
export const FitnessActivityType = z.enum([
  'AlpineSki',
  'BackcountrySki',
  'Canoeing',
  'Crossfit',
  'EBikeRide',
  'Elliptical',
  'Golf',
  'GravelRide',
  'Handcycle',
  'Hike',
  'IceSkate',
  'InlineSkate',
  'Kayaking',
  'Kitesurf',
  'NordicSki',
  'Ride',
  'RockClimbing',
  'RollerSki',
  'Rowing',
  'Run',
  'Sail',
  'Skateboard',
  'Snowboard',
  'Snowshoe',
  'Soccer',
  'StairStepper',
  'StandUpPaddling',
  'Surfing',
  'Swim',
  'Velomobile',
  'VirtualRide',
  'VirtualRun',
  'Walk',
  'WeightTraining',
  'Wheelchair',
  'Windsurf',
  'Workout',
  'Yoga'
])
export type FitnessActivityType = z.infer<typeof FitnessActivityType>

export const LatLng = z.tuple([z.number(), z.number()])
export type LatLng = z.infer<typeof LatLng>

export const FitnessActivity = z.object({
  id: z.string(),
  actorId: z.string(),
  stravaActivityId: z.number(),
  statusId: z.string().nullish(),

  // Activity basics
  name: z.string(),
  type: z.string(),
  sportType: z.string().nullish(),
  startDate: z.date(),
  timezone: z.string().nullish(),

  // Metrics
  distance: z.number().nullish(), // meters
  movingTime: z.number().int().nullish(), // seconds
  elapsedTime: z.number().int().nullish(), // seconds
  totalElevationGain: z.number().nullish(), // meters
  averageSpeed: z.number().nullish(), // m/s
  maxSpeed: z.number().nullish(),
  averageHeartrate: z.number().nullish(),
  maxHeartrate: z.number().nullish(),
  averageCadence: z.number().nullish(),
  averageWatts: z.number().nullish(),
  kilojoules: z.number().nullish(),
  calories: z.number().nullish(),

  // Location
  startLatlng: LatLng.nullish(),
  endLatlng: LatLng.nullish(),
  summaryPolyline: z.string().nullish(),

  // Map attachment
  mapAttachmentId: z.string().nullish(),

  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date()
})
export type FitnessActivity = z.infer<typeof FitnessActivity>

export interface CreateFitnessActivityParams {
  id: string
  actorId: string
  stravaActivityId: number
  statusId?: string | null
  name: string
  type: string
  sportType?: string | null
  startDate: Date
  timezone?: string | null
  distance?: number | null
  movingTime?: number | null
  elapsedTime?: number | null
  totalElevationGain?: number | null
  averageSpeed?: number | null
  maxSpeed?: number | null
  averageHeartrate?: number | null
  maxHeartrate?: number | null
  averageCadence?: number | null
  averageWatts?: number | null
  kilojoules?: number | null
  calories?: number | null
  startLatlng?: LatLng | null
  endLatlng?: LatLng | null
  summaryPolyline?: string | null
  mapAttachmentId?: string | null
  rawData?: object | null
}

export interface UpdateFitnessActivityParams {
  statusId?: string | null
  name?: string
  type?: string
  sportType?: string | null
  distance?: number | null
  movingTime?: number | null
  elapsedTime?: number | null
  totalElevationGain?: number | null
  averageSpeed?: number | null
  maxSpeed?: number | null
  averageHeartrate?: number | null
  maxHeartrate?: number | null
  averageCadence?: number | null
  averageWatts?: number | null
  kilojoules?: number | null
  calories?: number | null
  startLatlng?: LatLng | null
  endLatlng?: LatLng | null
  summaryPolyline?: string | null
  mapAttachmentId?: string | null
  rawData?: object | null
}

// Strava API response types
export interface StravaDetailedActivity {
  id: number
  name: string
  type: string
  sport_type: string
  start_date: string
  start_date_local: string
  timezone: string
  distance: number
  moving_time: number
  elapsed_time: number
  total_elevation_gain: number
  average_speed: number
  max_speed: number
  average_heartrate?: number
  max_heartrate?: number
  average_cadence?: number
  average_watts?: number
  kilojoules?: number
  calories?: number
  start_latlng?: [number, number]
  end_latlng?: [number, number]
  map: {
    id: string
    summary_polyline: string
    polyline?: string
  }
  trainer: boolean
  commute: boolean
  private: boolean
}

export interface StravaTokenResponse {
  access_token: string
  refresh_token: string
  expires_at: number
  expires_in: number
  token_type: string
}
