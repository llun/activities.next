import { Database } from '@/lib/database/types'
import {
  FitnessActivityData,
  FitnessLap,
  FitnessMetricPoint,
  FitnessTrackPoint
} from '@/lib/services/fitness-files/activityData'
import {
  FitnessPrivacyLocation,
  annotatePointsWithPrivacy,
  buildPrivacySegments,
  downsamplePoints,
  downsamplePrivacySegments,
  flattenPrivacySegments
} from '@/lib/services/fitness-files/privacy'
import type { FitnessFileRouteData } from '@/lib/types/database/fitnessFileRouteData'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// Bump whenever the parser output, sample mapping, or rounding changes so
// cached rows written by an older version are treated as cache misses and
// re-derived on the next read or `backfillFitnessRouteData` run.
export const PRE_PARSED_ROUTE_DATA_VERSION = 1
// Bump whenever read-time privacy trimming (`privacy.ts`),
// `MAX_ROUTE_SAMPLE_POINTS`, or `toResponseSegments` response shaping changes
// so HTTP ETags invalidate without requiring stored rows to be re-parsed.
export const ROUTE_DATA_RESPONSE_VERSION = 1
export const MAX_ROUTE_SAMPLE_POINTS = 1_500
// Cap the pre-privacy track stored in `fitness_file_route_data` at 10× the
// served sample budget so privacy-zone boundaries stay accurate while bounding
// row size and JSON parse time on multi-hour activities.
export const MAX_CACHED_ROUTE_SAMPLE_POINTS = 15_000

export interface PreParsedRouteSample {
  lat: number
  lng: number
  elapsedSeconds: number
  timestamp?: number
  heartRate?: number
  altitude?: number
  speed?: number
  power?: number
  cadence?: number
  temperature?: number
  leftRightBalance?: number
  distanceMeters?: number
  gradePercent?: number
}

export interface PreParsedMetricSample {
  elapsedSeconds: number
  timestamp?: number
  distanceMeters?: number
  power?: number
  heartRate?: number
  cadence?: number
  speed?: number
  altitude?: number
  temperature?: number
  leftRightBalance?: number
  gradePercent?: number
}

export interface PreParsedRouteDataPayload {
  version: number
  totalDurationSeconds: number
  routeSamples?: PreParsedRouteSample[]
  metricSamples?: PreParsedMetricSample[]
  powerSeries?: number[]
  heartRateSeries?: number[]
  altitudeSeries?: number[]
  speedSeries?: number[]
  laps?: FitnessLap[]
  calories?: number
}

export interface FitnessRouteSample extends PreParsedRouteSample {
  isHiddenByPrivacy: boolean
}

export interface FitnessRouteSegment {
  isHiddenByPrivacy: boolean
  samples: FitnessRouteSample[]
}

export interface FitnessRouteDataResponse {
  samples: FitnessRouteSample[]
  segments: FitnessRouteSegment[]
  totalDurationSeconds: number
  powerSeries?: number[]
  heartRateSeries?: number[]
  altitudeSeries?: number[]
  speedSeries?: number[]
  laps?: FitnessLap[]
  calories?: number
  metricSamples?: PreParsedMetricSample[]
}

const round5 = (value: number) => Math.round(value * 1e5) / 1e5
const round1 = (value: number) => Math.round(value * 10) / 10
const roundInt = (value: number) => Math.round(value)

export const toRouteSamples = (
  points: FitnessTrackPoint[],
  totalDurationSeconds: number
): PreParsedRouteSample[] => {
  if (points.length === 0) return []

  const boundedPoints = downsamplePoints(points, MAX_CACHED_ROUTE_SAMPLE_POINTS)
  const firstTimestamp = boundedPoints[0].timestamp?.getTime()
  const lastTimestamp =
    boundedPoints[boundedPoints.length - 1].timestamp?.getTime()
  const hasTimestampRange =
    typeof firstTimestamp === 'number' &&
    typeof lastTimestamp === 'number' &&
    lastTimestamp > firstTimestamp

  return boundedPoints.map((point, index) => {
    let elapsedSeconds = 0

    if (hasTimestampRange && point.timestamp) {
      elapsedSeconds = (point.timestamp.getTime() - firstTimestamp) / 1000
    } else if (boundedPoints.length > 1) {
      const ratio = index / (boundedPoints.length - 1)
      elapsedSeconds = ratio * Math.max(0, totalDurationSeconds)
    }

    const sample: PreParsedRouteSample = {
      lat: round5(point.lat),
      lng: round5(point.lng),
      elapsedSeconds: round1(elapsedSeconds)
    }

    if (point.timestamp) {
      sample.timestamp = point.timestamp.getTime()
    }
    if (typeof point.heartRate === 'number') {
      sample.heartRate = roundInt(point.heartRate)
    }
    const altitude = point.altitude ?? point.altitudeMeters
    if (typeof altitude === 'number') {
      sample.altitude = round1(altitude)
    }
    if (typeof point.speed === 'number') {
      sample.speed = round1(point.speed)
    }
    if (typeof point.power === 'number') {
      sample.power = roundInt(point.power)
    }
    if (typeof point.cadence === 'number') {
      sample.cadence = roundInt(point.cadence)
    }
    if (typeof point.temperature === 'number') {
      sample.temperature = round1(point.temperature)
    }
    if (typeof point.leftRightBalance === 'number') {
      sample.leftRightBalance = round1(point.leftRightBalance)
    }
    if (typeof point.distanceMeters === 'number') {
      sample.distanceMeters = round1(point.distanceMeters)
    }
    const grade =
      (point as { gradePercent?: number; grade?: number }).gradePercent ??
      (point as { gradePercent?: number; grade?: number }).grade
    if (typeof grade === 'number') {
      sample.gradePercent = round1(grade)
    }

    return sample
  })
}

export const toMetricSamples = (
  points: FitnessMetricPoint[],
  totalDurationSeconds: number
): PreParsedMetricSample[] => {
  const firstTimestamp = points
    .find((point) => point.timestamp)
    ?.timestamp?.getTime()
  const indices = downsamplePoints(
    points.map((_, index) => index),
    MAX_ROUTE_SAMPLE_POINTS
  )

  return indices.map((index) => {
    const point = points[index]
    const timestampMs = point.timestamp?.getTime()
    const elapsedSeconds =
      typeof firstTimestamp === 'number' && typeof timestampMs === 'number'
        ? Math.max(0, (timestampMs - firstTimestamp) / 1000)
        : points.length > 1
          ? (index / (points.length - 1)) * Math.max(0, totalDurationSeconds)
          : 0

    const sample: PreParsedMetricSample = {
      elapsedSeconds: round1(elapsedSeconds)
    }
    if (typeof timestampMs === 'number') sample.timestamp = timestampMs
    if (typeof point.power === 'number') sample.power = roundInt(point.power)
    if (typeof point.heartRate === 'number')
      sample.heartRate = roundInt(point.heartRate)
    if (typeof point.cadence === 'number')
      sample.cadence = roundInt(point.cadence)
    if (typeof point.altitude === 'number')
      sample.altitude = round1(point.altitude)
    if (typeof point.speed === 'number') sample.speed = round1(point.speed)
    if (typeof point.temperature === 'number')
      sample.temperature = round1(point.temperature)
    if (typeof point.leftRightBalance === 'number')
      sample.leftRightBalance = round1(point.leftRightBalance)
    if (typeof point.distanceMeters === 'number')
      sample.distanceMeters = round1(point.distanceMeters)
    const grade =
      (point as { gradePercent?: number; grade?: number }).gradePercent ??
      (point as { gradePercent?: number; grade?: number }).grade
    if (typeof grade === 'number') {
      sample.gradePercent = round1(grade)
    }

    return sample
  })
}

export const toOptionalMetrics = (point: {
  power?: number
  cadence?: number
  temperature?: number
  leftRightBalance?: number
  distanceMeters?: number
  gradePercent?: number
}) => ({
  ...(typeof point.power === 'number' ? { power: point.power } : null),
  ...(typeof point.cadence === 'number' ? { cadence: point.cadence } : null),
  ...(typeof point.temperature === 'number'
    ? { temperature: point.temperature }
    : null),
  ...(typeof point.leftRightBalance === 'number'
    ? { leftRightBalance: point.leftRightBalance }
    : null),
  ...(typeof point.distanceMeters === 'number'
    ? { distanceMeters: point.distanceMeters }
    : null),
  ...(typeof point.gradePercent === 'number'
    ? { gradePercent: point.gradePercent }
    : null)
})

export const rebaseDistanceOnFirstVisible = <
  T extends { distanceMeters?: number; isHiddenByPrivacy: boolean }
>(
  samples: T[]
): T[] => {
  const offset = samples.find(
    (sample) =>
      !sample.isHiddenByPrivacy && typeof sample.distanceMeters === 'number'
  )?.distanceMeters
  if (typeof offset !== 'number' || offset === 0) return samples

  return samples.map((sample) =>
    typeof sample.distanceMeters === 'number'
      ? {
          ...sample,
          distanceMeters: round1(Math.max(0, sample.distanceMeters - offset))
        }
      : sample
  )
}

export const toResponseSegments = (
  segments: Array<{ isHiddenByPrivacy: boolean; points: FitnessRouteSample[] }>
): FitnessRouteSegment[] => {
  return segments.map((segment) => ({
    isHiddenByPrivacy: segment.isHiddenByPrivacy,
    samples: segment.points.map((point) => ({
      lat: point.lat,
      lng: point.lng,
      elapsedSeconds: point.elapsedSeconds,
      isHiddenByPrivacy: point.isHiddenByPrivacy,
      ...(point.timestamp ? { timestamp: point.timestamp } : null),
      ...(typeof point.heartRate === 'number'
        ? { heartRate: point.heartRate }
        : null),
      ...(typeof point.altitude === 'number'
        ? { altitude: point.altitude }
        : null),
      ...(typeof point.speed === 'number' ? { speed: point.speed } : null),
      ...toOptionalMetrics(point)
    }))
  }))
}

export const createPreParsedRouteDataPayload = (
  activityData: FitnessActivityData
): PreParsedRouteDataPayload => {
  const payload: PreParsedRouteDataPayload = {
    version: PRE_PARSED_ROUTE_DATA_VERSION,
    totalDurationSeconds: activityData.totalDurationSeconds
  }

  if (activityData.trackPoints && activityData.trackPoints.length > 0) {
    payload.routeSamples = toRouteSamples(
      activityData.trackPoints,
      activityData.totalDurationSeconds
    )
  } else if (
    activityData.metricPoints &&
    activityData.metricPoints.length > 0
  ) {
    payload.metricSamples = toMetricSamples(
      activityData.metricPoints,
      activityData.totalDurationSeconds
    )
  }

  if (activityData.powerSeries && activityData.powerSeries.length > 0) {
    payload.powerSeries = activityData.powerSeries
  }
  if (activityData.heartRateSeries && activityData.heartRateSeries.length > 0) {
    payload.heartRateSeries = activityData.heartRateSeries
  }
  if (activityData.altitudeSeries && activityData.altitudeSeries.length > 0) {
    payload.altitudeSeries = activityData.altitudeSeries
  }
  if (activityData.speedSeries && activityData.speedSeries.length > 0) {
    payload.speedSeries = activityData.speedSeries
  }
  if (activityData.laps && activityData.laps.length > 0) {
    payload.laps = activityData.laps
  }
  if (typeof activityData.calories === 'number') {
    payload.calories = activityData.calories
  }

  return payload
}

export type SavePreParsedRouteDataParams = {
  fitnessFileId: string
  actorId: string
} & (
  | {
      activityData: FitnessActivityData
      payload?: PreParsedRouteDataPayload
    }
  | {
      activityData?: FitnessActivityData
      payload: PreParsedRouteDataPayload
    }
)

export const savePreParsedRouteData = async (
  database: Database,
  params: SavePreParsedRouteDataParams
): Promise<FitnessFileRouteData> => {
  const payload =
    params.payload ?? createPreParsedRouteDataPayload(params.activityData!)
  return database.upsertFitnessFileRouteData({
    fitnessFileId: params.fitnessFileId,
    actorId: params.actorId,
    routeData: JSON.stringify(payload),
    sourceVersion: PRE_PARSED_ROUTE_DATA_VERSION
  })
}

export const hasPreParsedRouteData = async (
  database: Pick<Database, 'getFitnessFileRouteDataMetadata'>,
  fitnessFileId: string
): Promise<boolean> => {
  const metadata = await database.getFitnessFileRouteDataMetadata({
    fitnessFileId
  })
  return Boolean(
    metadata && metadata.sourceVersion === PRE_PARSED_ROUTE_DATA_VERSION
  )
}

export const loadPreParsedRouteData = async (
  database: Database,
  fitnessFileId: string
): Promise<PreParsedRouteDataPayload | null> => {
  const row = await database.getFitnessFileRouteData({ fitnessFileId })
  if (!row) {
    return null
  }
  if (
    typeof row.sourceVersion === 'number' &&
    row.sourceVersion !== PRE_PARSED_ROUTE_DATA_VERSION
  ) {
    return null
  }
  try {
    const payload = JSON.parse(row.routeData) as PreParsedRouteDataPayload
    if (payload.version !== PRE_PARSED_ROUTE_DATA_VERSION) {
      return null
    }
    return payload
  } catch (error) {
    logger.warn({
      message: 'Failed to parse pre-parsed route data from database',
      fitnessFileId,
      err: toLoggableError(error)
    })
    return null
  }
}

export const resolveRouteDataFromPreParsed = (
  preParsed: PreParsedRouteDataPayload,
  options: {
    canViewHiddenZone: boolean
    privacyLocations: FitnessPrivacyLocation[]
  }
): FitnessRouteDataResponse => {
  let responseSamples: FitnessRouteSample[] = []
  let responseSegments: FitnessRouteSegment[] = []

  if (preParsed.routeSamples && preParsed.routeSamples.length > 0) {
    const routeSamples: FitnessRouteSample[] = preParsed.routeSamples.map(
      (sample) => ({
        ...sample,
        isHiddenByPrivacy: false
      })
    )

    const annotatedSamples = annotatePointsWithPrivacy(
      routeSamples,
      options.privacyLocations
    )

    const privacyAwareSamples =
      !options.canViewHiddenZone &&
      annotatedSamples.some((sample) => sample.isHiddenByPrivacy)
        ? rebaseDistanceOnFirstVisible(annotatedSamples)
        : annotatedSamples

    const routeSegments = buildPrivacySegments(privacyAwareSamples, {
      includeHidden: options.canViewHiddenZone,
      includeVisible: true
    })

    const sampledSegments = downsamplePrivacySegments(
      routeSegments,
      MAX_ROUTE_SAMPLE_POINTS,
      {
        minimumPointsPerSegment: 2
      }
    )

    responseSamples = flattenPrivacySegments(sampledSegments)
    responseSegments = toResponseSegments(sampledSegments)
  }

  const response: FitnessRouteDataResponse = {
    samples: responseSamples,
    segments: responseSegments,
    totalDurationSeconds: preParsed.totalDurationSeconds
  }

  if (preParsed.powerSeries && preParsed.powerSeries.length > 0) {
    response.powerSeries = preParsed.powerSeries
  }
  if (preParsed.heartRateSeries && preParsed.heartRateSeries.length > 0) {
    response.heartRateSeries = preParsed.heartRateSeries
  }
  if (preParsed.altitudeSeries && preParsed.altitudeSeries.length > 0) {
    response.altitudeSeries = preParsed.altitudeSeries
  }
  if (preParsed.speedSeries && preParsed.speedSeries.length > 0) {
    response.speedSeries = preParsed.speedSeries
  }
  if (preParsed.laps && preParsed.laps.length > 0) {
    response.laps = preParsed.laps
  }
  if (typeof preParsed.calories === 'number') {
    response.calories = preParsed.calories
  }
  if (
    (!preParsed.routeSamples || preParsed.routeSamples.length === 0) &&
    preParsed.metricSamples &&
    preParsed.metricSamples.length > 0
  ) {
    response.metricSamples = preParsed.metricSamples
  }

  return response
}
