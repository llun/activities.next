import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getPresignedUrl } from '@/lib/services/medias'
import { PresigedMediaInput } from '@/lib/services/medias/types'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const POST = traceApiRoute(
  'getPresignedUrl',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    try {
      const content = await req.json()
      const presigned = await getPresignedUrl(
        database,
        currentActor,
        PresigedMediaInput.parse(content)
      )

      if (!presigned) {
        return apiErrorResponse(404)
      }
      return Response.json({ presigned })
    } catch {
      return apiErrorResponse(422)
    }
  })
)
