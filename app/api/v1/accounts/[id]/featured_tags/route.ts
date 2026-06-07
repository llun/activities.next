import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonFeaturedTag } from '@/lib/services/mastodon/getMastodonFeaturedTag'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// GET /api/v1/accounts/:id/featured_tags — the hashtags an account features.
// https://docs.joinmastodon.org/methods/accounts/#featured_tags
// Public (Mastodon serves this with no doorkeeper scope); optional auth.
// Local actors return their stored featured tags; remote actors return what
// this server has parsed (currently none — inbound parsing is not implemented),
// so the remote branch returns [] rather than erroring.
export const GET = traceApiRoute(
  'getAccountFeaturedTags',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, context) => {
      const { database, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

      const id = idToUrl(encodedAccountId)
      const actor = await database.getActorFromId({ id })
      if (!actor) return apiCorsError(req, CORS_HEADERS, 404)

      const host = headerHost(req.headers)
      const tags = await database.getFeaturedTags({ actorId: id })
      const data = tags.map((tag) =>
        getMastodonFeaturedTag({ host, actor, tag })
      )

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS), matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
