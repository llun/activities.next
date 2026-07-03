import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.DELETE]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  account_id: string
}

// https://docs.joinmastodon.org/methods/suggestions/#remove
// Dismissal is idempotent, so removing an unknown or already-dismissed
// account still returns an empty object like Mastodon.
export const DELETE = traceApiRoute(
  'removeSuggestion',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum.write],
    async (req, { database, currentActor, params }) => {
      const { account_id: accountId } = await params
      await database.dismissSuggestion({
        actorId: currentActor.id,
        targetActorId: idToUrl(accountId)
      })
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
