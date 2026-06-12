import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import {
  getSuggestionAccounts,
  normalizeSuggestionsLimit
} from '@/lib/services/suggestions/getSuggestionAccounts'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/suggestions/#v1
// Deprecated v1 shape: the same ranked suggestions as /api/v2/suggestions but
// returned as a plain array of accounts without the suggestion wrapper.
export const GET = traceApiRoute(
  'getSuggestionsV1',
  OAuthGuard([Scope.enum.read], async (req, { database, currentActor }) => {
    const limit = normalizeSuggestionsLimit(
      new URL(req.url).searchParams.get('limit')
    )
    const accounts = await getSuggestionAccounts({
      database,
      actorId: currentActor.id,
      limit
    })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: accounts })
  })
)
