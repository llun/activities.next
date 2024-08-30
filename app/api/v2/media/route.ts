import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { saveMedia } from '@/lib/services/medias'
import { MediaSchema } from '@/lib/services/medias/types'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse } from '@/lib/utils/response'

export const POST = AuthenticatedGuard(async (req, context) => {
  try {
    const { storage, currentActor } = context
    const form = await req.formData()
    const media = MediaSchema.parse(Object.fromEntries(form.entries()))
    const response = await saveMedia(storage, currentActor, media)
    if (!response) return apiErrorResponse(422)
    return Response.json(response)
  } catch (e) {
    const nodeErr = e as NodeJS.ErrnoException
    logger.error(nodeErr.message)
    logger.error(nodeErr.stack)
    return apiErrorResponse(422)
  }
})
