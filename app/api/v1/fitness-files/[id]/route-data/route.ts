import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { DEFAULT_FITNESS_MAX_FILE_SIZE } from '@/lib/config/fitnessStorage'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { METRIC_POINT_KEYS } from '@/lib/services/fitness-files/activityData'
import {
  FitnessLap,
  FitnessMetricPoint,
  FitnessTrackPoint,
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import {
  annotatePointsWithPrivacy,
  buildPrivacySegments,
  downsamplePoints,
  downsamplePrivacySegments,
  flattenPrivacySegments,
  getFitnessPrivacyLocations
} from '@/lib/services/fitness-files/privacy'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { getVisibility } from '@/lib/utils/getVisibility'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_400,
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { readResponseArrayBufferWithLimit } from '@/lib/utils/streamLimit'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
}

interface FitnessRouteSample {
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
  isHiddenByPrivacy: boolean
}

interface FitnessMetricSample {
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
}

interface FitnessRouteSegment {
  isHiddenByPrivacy: boolean
  samples: FitnessRouteSample[]
}

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const MAX_ROUTE_SAMPLE_POINTS = 1_500

type RouteDataResponsePayload = {
  samples: FitnessRouteSample[]
  segments: FitnessRouteSegment[]
  totalDurationSeconds: number
  powerSeries?: unknown
  heartRateSeries?: unknown
  altitudeSeries?: unknown
  speedSeries?: unknown
  laps?: FitnessLap[]
  calories?: number
  metricSamples?: FitnessMetricSample[]
}

const getFetchResponseErrorDetail = async (
  response: Response
): Promise<string> => {
  const responseText = await response.text().catch(() => '')
  if (!responseText) {
    return response.statusText || 'Unknown fetch error'
  }

  try {
    const parsedError = JSON.parse(responseText) as {
      message?: string
      error?: string
      status?: string
    }
    return (
      parsedError.message ||
      parsedError.error ||
      parsedError.status ||
      responseText
    )
  } catch {
    return responseText
  }
}

// Optional per-point metrics, emitted only when the file recorded them so a
// file without (say) temperature does not carry `temperature: undefined` keys.
const toOptionalMetrics = (point: {
  power?: number
  cadence?: number
  temperature?: number
  leftRightBalance?: number
  distanceMeters?: number
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
    : null)
})

const toRouteSamples = (
  points: FitnessTrackPoint[],
  totalDurationSeconds: number
): FitnessRouteSample[] => {
  if (points.length === 0) return []

  const firstTimestamp = points[0].timestamp?.getTime()
  const lastTimestamp = points[points.length - 1].timestamp?.getTime()
  const hasTimestampRange =
    typeof firstTimestamp === 'number' &&
    typeof lastTimestamp === 'number' &&
    lastTimestamp > firstTimestamp

  return points.map((point, index) => {
    let elapsedSeconds = 0

    if (hasTimestampRange && point.timestamp) {
      elapsedSeconds = (point.timestamp.getTime() - firstTimestamp) / 1000
    } else if (points.length > 1) {
      const ratio = index / (points.length - 1)
      elapsedSeconds = ratio * Math.max(0, totalDurationSeconds)
    }

    return {
      lat: point.lat,
      lng: point.lng,
      elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
      isHiddenByPrivacy: false,
      ...(point.timestamp ? { timestamp: point.timestamp.getTime() } : null),
      heartRate: point.heartRate,
      altitude: point.altitude,
      speed: point.speed,
      ...toOptionalMetrics(point)
    }
  })
}

// Time-aligned samples for activities with no GPS track (indoor trainers,
// treadmills). Elapsed time is measured from the first timestamped sample, and
// samples without a usable timestamp are spread evenly over the duration, as
// `toRouteSamples` does. Only called when there is no track, so no coordinates
// or privacy zones are involved. Points are picked (not averaged) down to the
// sample limit before being mapped.
const toMetricSamples = (
  points: FitnessMetricPoint[],
  totalDurationSeconds: number
): FitnessMetricSample[] => {
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

    const sample: FitnessMetricSample = {
      elapsedSeconds: Number(elapsedSeconds.toFixed(3))
    }
    if (typeof timestampMs === 'number') sample.timestamp = timestampMs
    for (const key of METRIC_POINT_KEYS) {
      const value = point[key]
      if (typeof value === 'number') sample[key] = value
    }
    return sample
  })
}

// A non-owner's response drops the privacy-hidden head and tail, but the
// cumulative distance of the first sample left would still say how far the
// hidden part was. Re-measure from the first visible sample instead.
const rebaseDistanceOnFirstVisible = <
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
          distanceMeters: Number(
            Math.max(0, sample.distanceMeters - offset).toFixed(3)
          )
        }
      : sample
  )
}

const toResponseSegments = (
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
      heartRate: point.heartRate,
      altitude: point.altitude,
      speed: point.speed,
      ...toOptionalMetrics(point)
    }))
  }))
}

const getFitnessFileBuffer = async (
  fitnessFileId: string,
  fileMetadata: FitnessFile,
  database: Database
) => {
  const result = await getFitnessFile(database, fitnessFileId, fileMetadata)
  if (!result) {
    return null
  }

  if (result.type === 'buffer') {
    return result.buffer
  }

  const response = await fetch(result.redirectUrl)
  if (!response.ok) {
    const detail = await getFetchResponseErrorDetail(response)
    throw new Error(
      `Failed to download fitness file from redirect URL (${response.status}): ${detail}`
    )
  }

  return Buffer.from(
    await readResponseArrayBufferWithLimit(
      response,
      getConfig().fitnessStorage?.maxFileSize ??
        fileMetadata.bytes ??
        DEFAULT_FITNESS_MAX_FILE_SIZE,
      'Fitness redirect body'
    )
  )
}

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getFitnessRouteData',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const { id } = await context.params

    try {
      const session = await getServerAuthSession()
      const currentActor = await getActorFromSession(database, session)
      const currentAccountId = currentActor?.account?.id

      const fileMetadata = await database.getFitnessFile({ id })
      if (!fileMetadata) {
        logger.warn({
          message: 'Fitness file not found',
          fileId: id
        })
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const fileActor = await database.getActorFromId({
        id: fileMetadata.actorId
      })
      const ownerAccountId = fileActor?.account?.id
      const isOwnerAccount = Boolean(
        currentAccountId && ownerAccountId === currentAccountId
      )
      let isPubliclyAccessible = false

      if (!isOwnerAccount) {
        if (!fileMetadata.statusId) {
          logger.warn({
            message: 'Fitness file not found or not authorized',
            fileId: id,
            actorId: currentActor?.id ?? null,
            accountId: currentAccountId ?? null
          })
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
        }

        const status = await database.getStatus({
          statusId: fileMetadata.statusId,
          withReplies: false
        })
        const visibility = status ? getVisibility(status.to, status.cc) : null
        isPubliclyAccessible =
          visibility === 'public' || visibility === 'unlisted'

        let hasAccess = isPubliclyAccessible

        if (status && !hasAccess) {
          if (currentActor?.id === status.actorId) {
            hasAccess = true
          } else {
            const hasFollowersUrl = [...status.to, ...status.cc].some((item) =>
              item.endsWith('/followers')
            )

            if (hasFollowersUrl && currentActor) {
              const follow = await database.getAcceptedOrRequestedFollow({
                actorId: currentActor.id,
                targetActorId: status.actorId
              })
              hasAccess = follow?.status === FollowStatus.enum.Accepted
            } else if (currentActor) {
              hasAccess =
                status.to.includes(currentActor.id) ||
                status.cc.includes(currentActor.id)
            }
          }
        }

        if (!status || !hasAccess) {
          logger.warn({
            message: 'Fitness file not found or not authorized',
            fileId: id,
            actorId: currentActor?.id ?? null,
            accountId: currentAccountId ?? null,
            visibility
          })
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
        }
      }

      if (!isParseableFitnessFileType(fileMetadata.fileType)) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const privacySettings = await database.getFitnessSettings({
        actorId: fileMetadata.actorId,
        serviceType: 'general'
      })
      const isAnonymousPublicRequest = isPubliclyAccessible && !currentActor

      const fitnessFileBuffer = await getFitnessFileBuffer(
        id,
        fileMetadata,
        database
      )
      if (!fitnessFileBuffer) {
        logger.warn({
          message: 'Fitness file not found',
          fileId: id
        })
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const activityData = await parseFitnessFile({
        fileType: fileMetadata.fileType,
        buffer: fitnessFileBuffer
      })
      const routeSamples = toRouteSamples(
        activityData.trackPoints,
        activityData.totalDurationSeconds
      )
      const privacyLocation = getFitnessPrivacyLocations(privacySettings)

      const annotatedSamples = annotatePointsWithPrivacy(
        routeSamples,
        privacyLocation
      )
      const privacyAwareSamples =
        !isOwnerAccount &&
        annotatedSamples.some((sample) => sample.isHiddenByPrivacy)
          ? rebaseDistanceOnFirstVisible(annotatedSamples)
          : annotatedSamples
      const routeSegments = buildPrivacySegments(privacyAwareSamples, {
        includeHidden: isOwnerAccount,
        includeVisible: true
      })
      const sampledSegments = downsamplePrivacySegments(
        routeSegments,
        MAX_ROUTE_SAMPLE_POINTS,
        {
          minimumPointsPerSegment: 2
        }
      )
      const responseSamples = flattenPrivacySegments(sampledSegments)
      const responseSegments = toResponseSegments(sampledSegments)
      // Only for activities without a GPS track: outdoor activities keep the
      // privacy-filtered samples as their single source of per-point data.
      const metricSamples =
        activityData.trackPoints.length === 0 && activityData.metricPoints
          ? toMetricSamples(
              activityData.metricPoints,
              activityData.totalDurationSeconds
            )
          : []
      const payload: RouteDataResponsePayload = {
        samples: responseSamples,
        segments: responseSegments,
        totalDurationSeconds: activityData.totalDurationSeconds,
        powerSeries: activityData.powerSeries,
        heartRateSeries: activityData.heartRateSeries,
        altitudeSeries: activityData.altitudeSeries,
        speedSeries: activityData.speedSeries,
        // Laps are time offsets and aggregates only (no coordinates), so they
        // are safe to return to non-owners regardless of privacy zones.
        ...(activityData.laps && activityData.laps.length > 0
          ? { laps: activityData.laps }
          : null),
        ...(typeof activityData.calories === 'number'
          ? { calories: activityData.calories }
          : null),
        ...(metricSamples.length > 0 ? { metricSamples } : null)
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: payload,
        additionalHeaders: [
          [
            'Cache-Control',
            isAnonymousPublicRequest
              ? 'public, max-age=60'
              : 'private, no-store'
          ],
          ['Vary', 'Authorization, Cookie']
        ]
      })
    } catch (error) {
      const err = error as Error
      logger.error({
        message: 'Error retrieving fitness route data',
        fileId: id,
        error: err.message
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }
  }
)
