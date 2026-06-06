import { buildCredentialAccount } from '@/lib/services/accounts/credentialAccount'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// GET /api/v1/accounts/verify_credentials — test token + view CredentialAccount.
// https://docs.joinmastodon.org/methods/accounts/#verify_credentials
// Scope: read:accounts (satisfied by the aggregate `read`).
export const GET = traceApiRoute(
  'verifyCredentials',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, context) => {
      const { currentActor, database } = context
      const [account, followRequestsCount] = await Promise.all([
        database.getMastodonActorFromId({ id: currentActor.id }),
        database.getFollowRequestsCount({ targetActorId: currentActor.id })
      ])
      if (!account) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: buildCredentialAccount({ account, followRequestsCount })
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
