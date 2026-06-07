import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonTag } from '@/lib/services/mastodon/getMastodonTag'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

// Mastodon's SuggestionsController caps results at RECENT_TAGS_LIMIT = 10.
const SUGGESTIONS_LIMIT = 10

export const OPTIONS = defaultOptions(CORS_HEADERS)

// GET /api/v1/featured_tags/suggestions — the current account's most-used
// hashtags that are not already featured.
// https://docs.joinmastodon.org/methods/featured_tags/#suggestions
// Scope read:accounts (satisfied by aggregate `read`). Returns Tag[].
export const GET = traceApiRoute(
  'getFeaturedTagsSuggestions',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, context) => {
      const { database, currentActor } = context
      const suggestions = await database.getFeaturedTagSuggestions({
        actorId: currentActor.id,
        limit: SUGGESTIONS_LIMIT
      })
      const data = suggestions.map((suggestion) =>
        getMastodonTag(suggestion.name, false)
      )
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
