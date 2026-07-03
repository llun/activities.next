import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import {
  getSuggestionAccounts,
  normalizeSuggestionsLimit
} from '@/lib/services/suggestions/getSuggestionAccounts'
import { Scope } from '@/lib/types/database/operations'
import { Suggestion } from '@/lib/types/mastodon'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/suggestions/#v2
export const GET = traceApiRoute(
  'getSuggestions',
  OAuthGuard([Scope.enum.read], async (req, { database, currentActor }) => {
    const limit = normalizeSuggestionsLimit(
      new URL(req.url).searchParams.get('limit')
    )
    const accounts = await getSuggestionAccounts({
      database,
      actorId: currentActor.id,
      limit
    })
    const suggestions = accounts.map((account): Suggestion => ({
      source: 'past_interactions',
      sources: ['friends_of_friends'],
      account
    }))
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: suggestions })
  })
)
