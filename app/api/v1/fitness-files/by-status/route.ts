import { getServerSession } from 'next-auth'
import { NextRequest } from 'next/server'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
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

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getFitnessFilesByStatus',
  async (req: NextRequest) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }

    const statusId = req.nextUrl.searchParams.get('statusId')
    if (!statusId) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    try {
      const session = await getServerSession(getAuthOptions())
      const currentActor = await getActorFromSession(database, session)

      const status = await database.getStatus({
        statusId,
        withReplies: false
      })
      if (!status) {
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
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
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
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
            description: file.description ?? null
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
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  }
)
