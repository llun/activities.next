import { apiErrorResponse } from '@/lib/response'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { saveMedia } from '@/lib/services/medias'
import { MediaSchema } from '@/lib/services/medias/types'

export const POST = AuthenticatedGuard(async (req, context) => {
  try {
    const { storage, currentActor } = context
    const form = await req.formData()
    const media = MediaSchema.parse(Object.fromEntries(form.entries()))
    const response = await saveMedia(storage, currentActor, media)
    if (!response) return apiErrorResponse(422)
    return Response.json(response)
  } catch {
    return apiErrorResponse(422)
  }
})
