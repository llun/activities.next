import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { FollowStatus } from '@/lib/types/domain/follow'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_400,
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getFitnessFilesByStatus',
  async (req: NextRequest) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const statusId = req.nextUrl.searchParams.get('statusId')
    if (!statusId) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    try {
      const session = await getServerAuthSession()
      const currentActor = await getActorFromSession(database, session)

      const status = await database.getStatus({
        statusId,
        withReplies: false
      })
      if (!status) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const visibility = getVisibility(status.to, status.cc)
      const isPubliclyAccessible =
        visibility === 'public' || visibility === 'unlisted'
      let hasAccess = isPubliclyAccessible

      if (!hasAccess && currentActor) {
        if (currentActor.id === status.actorId) {
          hasAccess = true
        } else {
          const hasFollowersUrl = [...status.to, ...status.cc].some((item) =>
            item.endsWith('/followers')
          )

          if (hasFollowersUrl) {
            const follow = await database.getAcceptedOrRequestedFollow({
              actorId: currentActor.id,
              targetActorId: status.actorId
            })
            hasAccess = follow?.status === FollowStatus.enum.Accepted
          } else {
            hasAccess =
              status.to.includes(currentActor.id) ||
              status.cc.includes(currentActor.id)
          }
        }
      }

      if (!hasAccess) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const files = await database.getFitnessFilesByStatus({ statusId })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          files: files.map((file) => ({
            id: file.id,
            actorId: file.actorId,
            fileName: file.fileName,
            fileType: file.fileType,
            isPrimary: file.isPrimary ?? true,
            statusId: file.statusId ?? null,
            processingStatus: file.processingStatus ?? 'pending',
            totalDistanceMeters: file.totalDistanceMeters ?? null,
            totalDurationSeconds: file.totalDurationSeconds ?? null,
            elevationGainMeters: file.elevationGainMeters ?? null,
            activityType: file.activityType ?? null,
            activityStartTime: file.activityStartTime ?? null,
            hasMapData: file.hasMapData ?? false,
            description: file.description ?? null,
            deviceManufacturer: file.deviceManufacturer ?? null,
            deviceName: file.deviceName ?? null
          }))
        }
      })
    } catch (error) {
      const nodeError = error as Error
      logger.error({
        message: 'Error fetching fitness files by status',
        statusId,
        error: nodeError.message
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
