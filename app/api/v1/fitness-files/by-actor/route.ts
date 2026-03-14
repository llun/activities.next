import { getServerSession } from 'next-auth'
import { NextRequest } from 'next/server'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
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
  'getFitnessFilesByActor',
  async (req: NextRequest) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }

    const actorId = req.nextUrl.searchParams.get('actorId')
    if (!actorId) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    try {
      const session = await getServerSession(getAuthOptions())
      const currentActor = await getActorFromSession(database, session)

      const actor = await database.getActorFromId({ id: actorId })
      if (!actor) {
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      // Only the actor themselves can view their matched activities list
      if (!currentActor || currentActor.id !== actorId) {
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      const files = await database.getFitnessFilesByActor({ actorId })

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
        message: 'Error fetching fitness files by actor',
        actorId,
        error: nodeError.message
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  }
)
