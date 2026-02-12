import { NextRequest } from 'next/server'

import { getFitnessFile } from '@/lib/services/fitness-files'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import { HTTP_STATUS, apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getFitnessFile',
  AuthenticatedGuard<Params>(async (_req: NextRequest, context) => {
    const { database, currentActor, params } = context
    const { id } = await params

    try {
      const fileMetadata = await database.getFitnessFile({ id })
      if (!fileMetadata || fileMetadata.actorId !== currentActor.id) {
        logger.warn({
          message: 'Fitness file not found or not authorized',
          fileId: id,
          actorId: currentActor.id
        })
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      const result = await getFitnessFile(database, id, fileMetadata)
      if (!result) {
        logger.warn({ message: 'Fitness file not found', fileId: id })
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      if (result.type === 'redirect') {
        return Response.redirect(result.redirectUrl, 302)
      }

      return new Response(result.buffer as BodyInit, {
        headers: {
          'Content-Type': result.contentType,
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    } catch (error) {
      const err = error as Error
      logger.error({
        message: 'Error retrieving fitness file',
        fileId: id,
        error: err.message
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  })
)
