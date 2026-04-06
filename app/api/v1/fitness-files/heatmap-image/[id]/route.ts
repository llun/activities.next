import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMedia } from '@/lib/services/medias'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { logger } from '@/lib/utils/logger'
import { HTTP_STATUS, apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getFitnessHeatmapImage',
  async (_req: NextRequest, context: { params: Promise<Params> }) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }

    const { id } = await context.params

    try {
      const session = await getServerAuthSession()
      if (!session?.user?.email) {
        return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
      }

      const currentActor = await getActorFromSession(database, session)
      if (!currentActor) {
        return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
      }

      const heatmap = await database.getFitnessHeatmap({ id })
      if (!heatmap || !heatmap.imagePath) {
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      if (currentActor.id !== heatmap.actorId) {
        return apiErrorResponse(HTTP_STATUS.FORBIDDEN)
      }

      const result = await getMedia(database, heatmap.imagePath)

      if (!result) {
        logger.warn({
          message: 'Heatmap image file not found in storage',
          heatmapId: id,
          imagePath: heatmap.imagePath
        })
        return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      }

      if (result.type === 'redirect') {
        return Response.redirect(result.redirectUrl, 302)
      }

      return new Response(result.buffer as BodyInit, {
        headers: {
          'Content-Type': result.contentType || 'image/png',
          'Cache-Control': 'private, max-age=3600'
        }
      })
    } catch (error) {
      const err = error as Error
      logger.error({
        message: 'Error retrieving heatmap image',
        heatmapId: id,
        error: err.message
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  }
)
