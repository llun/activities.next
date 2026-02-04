import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { saveMedia } from '@/lib/services/medias'
import { MediaSchema } from '@/lib/services/medias/types'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const POST = traceApiRoute(
  'uploadMediaV2',
  AuthenticatedGuard(async (req, context) => {
    try {
      const { database, currentActor } = context
      const form = await req.formData()
      const media = MediaSchema.parse(Object.fromEntries(form.entries()))
      const response = await saveMedia(database, currentActor, media)
      if (!response) return apiErrorResponse(422)
      return Response.json(response)
    } catch (e) {
      const nodeErr = e as NodeJS.ErrnoException
      logger.error(nodeErr)
      return apiErrorResponse(422)
    }
  })
)
