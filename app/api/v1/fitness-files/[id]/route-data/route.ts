import { getServerSession } from 'next-auth'
import { NextRequest } from 'next/server'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getFitnessFile } from '@/lib/services/fitness-files'
import {
  FitnessTrackPoint,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import {
  annotatePointsWithPrivacy,
  buildPrivacySegments,
  downsamplePrivacySegments,
  flattenPrivacySegments,
  getFitnessPrivacyLocation
} from '@/lib/services/fitness-files/privacy'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
}

interface FitnessRouteSample {
  lat: number
  lng: number
  elapsedSeconds: number
  timestamp?: number
  isHiddenByPrivacy: boolean
}

interface FitnessRouteSegment {
  isHiddenByPrivacy: boolean
  samples: FitnessRouteSample[]
}

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const MAX_ROUTE_SAMPLE_POINTS = 1_500

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
      ...(point.timestamp ? { timestamp: point.timestamp.getTime() } : null)
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
      ...(point.timestamp ? { timestamp: point.timestamp } : null)
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

  return Buffer.from(await response.arrayBuffer())
}

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getFitnessRouteData',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }

    const { id } = await context.params

    try {
      const session = await getServerSession(getAuthOptions())
      const currentActor = await getActorFromSession(database, session)
      const currentAccountId = currentActor?.account?.id

      const fileMetadata = await database.getFitnessFile({ id })
      if (!fileMetadata) {
        logger.warn({
          message: 'Fitness file not found',
          fileId: id
        })
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
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
          return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
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
          return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
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
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      const activityData = await parseFitnessFile({
        fileType: fileMetadata.fileType,
        buffer: fitnessFileBuffer
      })
      const routeSamples = toRouteSamples(
        activityData.trackPoints,
        activityData.totalDurationSeconds
      )
      const privacySettings = await database.getFitnessSettings({
        actorId: fileMetadata.actorId,
        serviceType: 'general'
      })
      const privacyLocation = getFitnessPrivacyLocation({
        privacyHomeLatitude: privacySettings?.privacyHomeLatitude,
        privacyHomeLongitude: privacySettings?.privacyHomeLongitude,
        privacyHideRadiusMeters: privacySettings?.privacyHideRadiusMeters
      })

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

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          samples: responseSamples,
          segments: responseSegments,
          totalDurationSeconds: activityData.totalDurationSeconds
        },
        additionalHeaders: [
          [
            'Cache-Control',
            isPubliclyAccessible ? 'no-store' : 'private, no-store'
          ]
        ]
      })
    } catch (error) {
      const err = error as Error
      logger.error({
        message: 'Error retrieving fitness route data',
        fileId: id,
        error: err.message
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  }
)
