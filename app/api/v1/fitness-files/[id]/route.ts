import { getServerSession } from 'next-auth'
import { NextRequest } from 'next/server'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
import { getFitnessFile } from '@/lib/services/fitness-files'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { getVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'
import { HTTP_STATUS, apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getFitnessFile',
  async (_req: NextRequest, context: { params: Promise<Params> }) => {
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

        if (!status || !isPubliclyAccessible) {
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
          'Cache-Control': isPubliclyAccessible
            ? 'public, max-age=31536000, immutable'
            : 'private, no-store'
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
  }
)
