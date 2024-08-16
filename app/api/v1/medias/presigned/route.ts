import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getPresignedUrl } from '@/lib/services/medias'
import { PresigedMediaInput } from '@/lib/services/medias/types'
import { apiErrorResponse } from '@/lib/utils/response'

export const POST = AuthenticatedGuard(async (req, context) => {
  const { storage, currentActor } = context
  try {
    const content = await req.json()
    const url = getPresignedUrl(
      storage,
      currentActor,
      PresigedMediaInput.parse(content)
    )
    return Response.json({ url })
  } catch {
    return apiErrorResponse(422)
  }
})
