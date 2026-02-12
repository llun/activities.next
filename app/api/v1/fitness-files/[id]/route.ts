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
      const accountId = currentActor.account?.id
      if (!accountId) {
        logger.warn({
          message: 'Unauthorized fitness file request - no account',
          actorId: currentActor.id,
          fileId: id
        })
        return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
      }

      const fileMetadata = await database.getFitnessFile({ id })
      if (!fileMetadata) {
        logger.warn({
          message: 'Fitness file not found',
          fileId: id,
          actorId: currentActor.id,
          accountId
        })
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      const fileActor = await database.getActorFromId({
        id: fileMetadata.actorId
      })
      const isOwnerAccount = fileActor?.account?.id === accountId
      if (!isOwnerAccount) {
        const linkedStatusId = fileMetadata.statusId
        const status = linkedStatusId
          ? await database.getStatus({
              statusId: linkedStatusId,
              currentActorId: currentActor.id,
              withReplies: false
            })
          : null

        if (!status) {
          logger.warn({
            message: 'Fitness file not found or not authorized',
            fileId: id,
            actorId: currentActor.id,
            accountId
          })
          return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
        }
      }

      const result = await getFitnessFile(database, id, fileMetadata)
      if (!result) {
        logger.warn({
          message: 'Fitness file not found',
          fileId: id
        })
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      if (result.type === 'redirect') {
        return Response.redirect(result.redirectUrl, 302)
      }

      return new Response(result.buffer as BodyInit, {
        headers: {
          'Content-Type': result.contentType,
          'Cache-Control': 'private, no-store'
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
