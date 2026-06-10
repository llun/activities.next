import { buildCredentialAccount } from '@/lib/services/accounts/credentialAccount'
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

// DELETE /api/v1/profile/header — remove the header image of the current actor.
// https://docs.joinmastodon.org/methods/profile/#delete-profile-header
export const DELETE = traceApiRoute(
  'deleteProfileHeader',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:accounts']],
    async (req, context) => {
      const { currentActor, database } = context
      await database.updateActor({
        actorId: currentActor.id,
        headerImageUrl: null
      })
      const [account, followRequestsCount] = await Promise.all([
        database.getMastodonActorFromId({ id: currentActor.id }),
        database.getFollowRequestsCount({ targetActorId: currentActor.id })
      ])
      if (!account) return apiCorsError(req, CORS_HEADERS, 500)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: buildCredentialAccount({ account, followRequestsCount })
      })
    },
    guardOptions
  )
)
