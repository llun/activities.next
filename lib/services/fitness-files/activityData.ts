import { normalizeStoredActivityType } from '@/lib/services/fitness-files/sportTypes'

export interface FitnessCoordinate {
  lat: number
  lng: number
}

export interface FitnessTrackPoint extends FitnessCoordinate {
  altitudeMeters?: number
  timestamp?: Date
  power?: number
  heartRate?: number
  altitude?: number
  speed?: number
}

export interface FitnessActivityData {
  coordinates: FitnessCoordinate[]
  trackPoints: FitnessTrackPoint[]
  totalDistanceMeters: number
  totalDurationSeconds: number
  movingTimeSeconds?: number
  elevationGainMeters?: number
  /** The canonical sport key the column is stored as. See `toActivityData`. */
  activityType?: string
  /**
   * The sport exactly as the source file spelled it, kept beside the canonical
   * key and never persisted.
   *
   * The key answers "which bike or which shoes", so it deliberately folds
   * `Handcycle` and `Velomobile` into `ride` and `VirtualRun` into `run`. A
   * post caption is not answering that question, and captioning a handcycle
   * ride "Cycling" erases a distinction the athlete made. The Strava importer
   * captions from its own raw `sport_type` and so kept the specificity, while
   * an uploaded file had already been collapsed by the time its caption was
   * built — the two paths disagreed about the same activity.
   */
  rawActivityType?: string
  startTime?: Date
  powerSeries?: number[]
  heartRateSeries?: number[]
  altitudeSeries?: number[]
  speedSeries?: number[]
  deviceManufacturer?: string
  deviceName?: string
}

export const EARTH_RADIUS_METERS = 6_371_000

export const haversineDistanceMeters = (
  first: FitnessCoordinate,
  second: FitnessCoordinate
): number => {
  const dLat = ((second.lat - first.lat) * Math.PI) / 180
  const dLng = ((second.lng - first.lng) * Math.PI) / 180
  const lat1 = (first.lat * Math.PI) / 180
  const lat2 = (second.lat * Math.PI) / 180

  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine))
}

export const getDistanceFromCoordinates = (
  coordinates: FitnessCoordinate[]
): number => {
  if (coordinates.length < 2) return 0

  let distance = 0
  for (let i = 1; i < coordinates.length; i += 1) {
    distance += haversineDistanceMeters(coordinates[i - 1], coordinates[i])
  }
  return distance
}

export const getElevationGain = (
  altitudes: Array<number | undefined>
): number | undefined => {
  let gain = 0
  let previous: number | undefined

  for (const altitude of altitudes) {
    if (typeof altitude !== 'number') continue
    if (typeof previous === 'number' && altitude > previous) {
      gain += altitude - previous
    }
    previous = altitude
  }

  if (gain <= 0) return undefined
  return gain
}

// Speeds at or below this are treated as "stopped" when accumulating moving
// time. 0.5 m/s (1.8 km/h) sits below any real cycling/running/walking pace but
// above the GPS jitter a stationary device reports, so it excludes genuine stops
// without trimming slow-but-moving segments. This approximates Strava's
// moving-time detection closely enough to reproduce its average speed.
export const STOPPED_SPEED_METERS_PER_SECOND = 0.5

export const getSegmentSpeedMetersPerSecond = (
  previous: FitnessTrackPoint,
  current: FitnessTrackPoint,
  deltaSeconds: number
): number | undefined => {
  // FitnessTrackPoint.speed is normalized to km/h during parsing; convert the
  // device-reported speeds to m/s. Averaging the two endpoints keeps the moving
  // portion of a segment that decelerates into (or accelerates out of) a stop,
  // matching how Strava treats those transitions.
  const deviceSpeedsMetersPerSecond = [previous.speed, current.speed]
    .filter((value): value is number => typeof value === 'number')
    .map((kilometersPerHour) => kilometersPerHour / 3.6)
  if (deviceSpeedsMetersPerSecond.length > 0) {
    return (
      deviceSpeedsMetersPerSecond.reduce((sum, value) => sum + value, 0) /
      deviceSpeedsMetersPerSecond.length
    )
  }

  // No device speed on either endpoint: fall back to how far the GPS moved over
  // the interval.
  if (deltaSeconds > 0) {
    return haversineDistanceMeters(previous, current) / deltaSeconds
  }

  return undefined
}

// Sum the time spent actually moving, excluding stopped intervals — the basis
// for Strava-style average pace/speed. A segment is only counted as stopped when
// we can positively measure its speed at or below the stopped threshold;
// unmeasurable segments are treated as moving so missing per-point data never
// shrinks moving time below elapsed time. Returns undefined when there are not
// enough timestamped points to measure anything (so callers fall back to the
// full elapsed duration).
export const getMovingTimeSeconds = (
  points: FitnessTrackPoint[]
): number | undefined => {
  let movingSeconds = 0
  let measuredAny = false

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1]
    const current = points[i]
    const previousMs = previous.timestamp?.getTime()
    const currentMs = current.timestamp?.getTime()
    if (typeof previousMs !== 'number' || typeof currentMs !== 'number') {
      continue
    }

    const deltaSeconds = (currentMs - previousMs) / 1000
    if (deltaSeconds <= 0) continue
    measuredAny = true

    const speed = getSegmentSpeedMetersPerSecond(
      previous,
      current,
      deltaSeconds
    )
    if (speed === undefined || speed > STOPPED_SPEED_METERS_PER_SECOND) {
      movingSeconds += deltaSeconds
    }
  }

  if (!measuredAny || movingSeconds <= 0) return undefined
  return movingSeconds
}

export const getDurationSeconds = (
  startTime?: Date,
  endTime?: Date,
  fallback?: number
): number => {
  if (
    typeof fallback === 'number' &&
    Number.isFinite(fallback) &&
    fallback > 0
  ) {
    return fallback
  }

  if (startTime && endTime) {
    const seconds = (endTime.getTime() - startTime.getTime()) / 1000
    if (seconds > 0) {
      return seconds
    }
  }

  return 0
}

export interface ToActivityDataParams {
  points: FitnessTrackPoint[]
  totalDistanceMeters?: number
  totalDurationSeconds?: number
  elevationGainMeters?: number
  activityType?: string
  startTime?: Date
}

export const toActivityData = ({
  points,
  totalDistanceMeters,
  totalDurationSeconds,
  elevationGainMeters,
  activityType,
  startTime
}: ToActivityDataParams): FitnessActivityData => {
  const coordinates = points.map(({ lat, lng }) => ({ lat, lng }))
  const trackPoints = points.map((point) => ({ ...point }))

  const distance =
    typeof totalDistanceMeters === 'number' && totalDistanceMeters > 0
      ? totalDistanceMeters
      : getDistanceFromCoordinates(coordinates)

  const timestamps = points
    .map((point) => point.timestamp)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())

  const duration = getDurationSeconds(
    timestamps[0],
    timestamps[timestamps.length - 1],
    totalDurationSeconds
  )

  const movingTimeSeconds = getMovingTimeSeconds(points)

  const computedElevationGain = getElevationGain(
    points.map((point) => point.altitudeMeters)
  )

  const powerSeries = points
    .map((point) => point.power)
    .filter((value): value is number => typeof value === 'number')

  const heartRateSeries = points
    .map((point) => point.heartRate)
    .filter((value): value is number => typeof value === 'number')

  const altitudeSeries = points
    .map((point) => point.altitude ?? point.altitudeMeters)
    .filter((value): value is number => typeof value === 'number')

  const speedSeries = points
    .map((point) => point.speed)
    .filter((value): value is number => typeof value === 'number')

  // Stored in the canonical form, never as the raw string the file carried:
  // the same ride reaches here as `cycling` from a FIT file, `Biking` from a
  // Garmin TCX and `Ride` from the TCX built for a Strava import, and
  // everything downstream that GROUPS on the value — the fitness overview
  // breakdown, the calendar filter, the per-type route-heatmap cache key —
  // would otherwise see three different activities. Every parser funnels
  // Non-gear activities collapse to training, rowing, or other.
  const storedActivityType = normalizeStoredActivityType(activityType)

  return {
    coordinates,
    trackPoints,
    totalDistanceMeters: distance,
    totalDurationSeconds: duration,
    // Moving time can never exceed the elapsed span; clamp defensively so a
    // slightly-larger measured value (e.g. from a lap fallback duration shorter
    // than the trackpoint span) never yields a moving time above elapsed.
    ...(typeof movingTimeSeconds === 'number' && movingTimeSeconds > 0
      ? {
          movingTimeSeconds:
            duration > 0
              ? Math.min(movingTimeSeconds, duration)
              : movingTimeSeconds
        }
      : null),
    ...(typeof elevationGainMeters === 'number' && elevationGainMeters > 0
      ? { elevationGainMeters }
      : typeof computedElevationGain === 'number'
        ? { elevationGainMeters: computedElevationGain }
        : null),
    ...(storedActivityType ? { activityType: storedActivityType } : null),
    ...(activityType?.trim() ? { rawActivityType: activityType.trim() } : null),
    ...(startTime
      ? { startTime }
      : timestamps[0]
        ? { startTime: timestamps[0] }
        : null),
    powerSeries,
    heartRateSeries,
    altitudeSeries,
    speedSeries
  }
}
