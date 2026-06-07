import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.DELETE]

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// DELETE /api/v1/featured_tags/:id — unfeature a hashtag.
// https://docs.joinmastodon.org/methods/featured_tags/#unfeature
// Scope write:accounts. The delete is owner-scoped (Mastodon looks the row up
// within current_account.featured_tags), so a tag owned by another actor — or a
// missing id — returns 404. On success Mastodon renders an empty object.
export const DELETE = traceApiRoute(
  'deleteFeaturedTag',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:accounts']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const id = (await params).id
      if (!id) return apiCorsError(req, CORS_HEADERS, 400)

      const removed = await database.deleteFeaturedTag({
        actorId: currentActor.id,
        id
      })
      if (!removed) return apiCorsError(req, CORS_HEADERS, 404)

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    },
    guardOptions
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { featuredTagId: params?.id || 'unknown' }
    }
  }
)
