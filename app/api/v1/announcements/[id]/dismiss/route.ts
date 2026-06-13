import { OAuthGuard, corsErrorResponse } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'dismissAnnouncement',
  OAuthGuard<Params>(
    [Scope.enum.write],
    async (req, { database, currentActor, params }) => {
      const { id } = await params

      const announcement = await database.getAnnouncement({ id })
      if (!announcement) return apiCorsError(req, CORS_HEADERS, 404)

      await database.markAnnouncementRead({
        announcementId: id,
        actorId: currentActor.id
      })

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    },
    guardOptions
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { announcementId: params?.id || 'unknown' }
    }
  }
)
