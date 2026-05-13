import { NextRequest } from 'next/server'

import { DEFAULT_FITNESS_MAX_FILE_SIZE } from '@/lib/config/fitnessStorage'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getFitnessFile } from '@/lib/services/fitness-files'
import {
  FitnessTrackPoint,
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import {
  annotatePointsWithPrivacy,
  buildPrivacySegments,
  downsamplePrivacySegments,
  flattenPrivacySegments,
  getFitnessPrivacyLocations
} from '@/lib/services/fitness-files/privacy'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_400,
  ERROR_404,
  ERROR_429,
  ERROR_500,
  HTTP_STATUS,
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
  isHiddenByPrivacy: boolean
}

interface FitnessRouteSegment {
  isHiddenByPrivacy: boolean
  samples: FitnessRouteSample[]
}

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const MAX_ROUTE_SAMPLE_POINTS = 1_500
const PUBLIC_ROUTE_DATA_CACHE_TTL_MS = 60_000
const PUBLIC_ROUTE_DATA_SECURITY_MAP_MAX_ENTRIES = 500
const PUBLIC_ROUTE_DATA_RATE_LIMIT_WINDOW_MS = 60_000
const PUBLIC_ROUTE_DATA_RATE_LIMIT_MAX_REQUESTS = 60

type RouteDataResponsePayload = {
  samples: FitnessRouteSample[]
  segments: FitnessRouteSegment[]
  totalDurationSeconds: number
  powerSeries?: unknown
  heartRateSeries?: unknown
  altitudeSeries?: unknown
  speedSeries?: unknown
}

const publicRouteDataCache = new Map<
  string,
  { expiresAt: number; payload: RouteDataResponsePayload }
>()
const routeDataRateLimit = new Map<string, { resetAt: number; count: number }>()

export const resetFitnessRouteDataSecurityStateForTests = () => {
  publicRouteDataCache.clear()
  routeDataRateLimit.clear()
}

export const getFitnessRouteDataSecurityStateForTests = () => ({
  publicRouteDataCacheSize: publicRouteDataCache.size,
  routeDataRateLimitSize: routeDataRateLimit.size
})

const pruneExpiredRouteDataSecurityEntries = (now: number) => {
  for (const [key, cached] of publicRouteDataCache) {
    if (cached.expiresAt <= now) {
      publicRouteDataCache.delete(key)
    }
  }

  for (const [key, rateLimit] of routeDataRateLimit) {
    if (rateLimit.resetAt <= now) {
      routeDataRateLimit.delete(key)
    }
  }
}

const pruneOldestMapEntries = <T>(map: Map<string, T>, maxEntries: number) => {
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value
    if (typeof oldestKey !== 'string') {
      return
    }
    map.delete(oldestKey)
  }
}

const setBoundedMapEntry = <T>(map: Map<string, T>, key: string, value: T) => {
  if (map.has(key)) {
    map.delete(key)
  }
  map.set(key, value)
  pruneOldestMapEntries(map, PUBLIC_ROUTE_DATA_SECURITY_MAP_MAX_ENTRIES)
}

export const seedFitnessRouteDataSecurityStateForTests = ({
  cacheKey,
  rateLimitKey
}: {
  cacheKey: string
  rateLimitKey: string
}) => {
  setBoundedMapEntry(publicRouteDataCache, cacheKey, {
    expiresAt: Date.now() + PUBLIC_ROUTE_DATA_CACHE_TTL_MS,
    payload: {
      samples: [],
      segments: [],
      totalDurationSeconds: 0
    }
  })
  setBoundedMapEntry(routeDataRateLimit, rateLimitKey, {
    resetAt: Date.now() + PUBLIC_ROUTE_DATA_RATE_LIMIT_WINDOW_MS,
    count: 1
  })
}

const getClientRateLimitKey = (req: NextRequest) => {
  const requestIp = (req as NextRequest & { ip?: string }).ip
  const forwardedFor = req.headers.get('x-forwarded-for')
  const originatingForwarded = forwardedFor?.split(',')[0]?.trim()
  return (
    requestIp ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    originatingForwarded ||
    'anonymous'
  )
}

const consumePublicRouteDataRateLimit = (key: string) => {
  const now = Date.now()
  pruneExpiredRouteDataSecurityEntries(now)
  const existing = routeDataRateLimit.get(key)
  if (!existing || existing.resetAt <= now) {
    setBoundedMapEntry(routeDataRateLimit, key, {
      resetAt: now + PUBLIC_ROUTE_DATA_RATE_LIMIT_WINDOW_MS,
      count: 1
    })
    return true
  }

  existing.count += 1
  return existing.count <= PUBLIC_ROUTE_DATA_RATE_LIMIT_MAX_REQUESTS
}

const getPrivacyLocationsCacheKeyPart = (privacyLocations: unknown) =>
  getHashFromString(JSON.stringify(privacyLocations ?? []))

const getPublicRouteDataCacheKey = ({
  fileMetadata,
  privacySettings
}: {
  fileMetadata: FitnessFile
  privacySettings?: {
    updatedAt?: number
    privacyHomeLatitude?: number
    privacyHomeLongitude?: number
    privacyHideRadiusMeters?: number
    privacyLocations?: unknown
  } | null
}) =>
  [
    fileMetadata.id,
    fileMetadata.updatedAt,
    fileMetadata.bytes,
    fileMetadata.processingStatus ?? '',
    privacySettings?.updatedAt ?? 0,
    privacySettings?.privacyHomeLatitude ?? '',
    privacySettings?.privacyHomeLongitude ?? '',
    privacySettings?.privacyHideRadiusMeters ?? '',
    getPrivacyLocationsCacheKeyPart(privacySettings?.privacyLocations)
  ].join(':')

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
      speed: point.speed
    }
  })
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
      speed: point.speed
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
      if (
        isAnonymousPublicRequest &&
        !consumePublicRouteDataRateLimit(getClientRateLimitKey(req))
      ) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_429,
          responseStatusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
          additionalHeaders: [['Retry-After', '60']]
        })
      }

      const publicCacheKey = isAnonymousPublicRequest
        ? getPublicRouteDataCacheKey({
            fileMetadata,
            privacySettings
          })
        : null
      if (publicCacheKey) {
        const cached = publicRouteDataCache.get(publicCacheKey)
        if (cached && cached.expiresAt > Date.now()) {
          setBoundedMapEntry(publicRouteDataCache, publicCacheKey, cached)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: cached.payload,
            additionalHeaders: [
              ['Cache-Control', 'public, max-age=60'],
              ['Vary', 'Authorization, Cookie'],
              ['X-Route-Data-Cache', 'HIT']
            ]
          })
        }
        if (cached) {
          publicRouteDataCache.delete(publicCacheKey)
        }
      }

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

      const privacyAwareSamples = annotatePointsWithPrivacy(
        routeSamples,
        privacyLocation
      )
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
      const payload: RouteDataResponsePayload = {
        samples: responseSamples,
        segments: responseSegments,
        totalDurationSeconds: activityData.totalDurationSeconds,
        powerSeries: activityData.powerSeries,
        heartRateSeries: activityData.heartRateSeries,
        altitudeSeries: activityData.altitudeSeries,
        speedSeries: activityData.speedSeries
      }

      if (publicCacheKey) {
        setBoundedMapEntry(publicRouteDataCache, publicCacheKey, {
          expiresAt: Date.now() + PUBLIC_ROUTE_DATA_CACHE_TTL_MS,
          payload
        })
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
