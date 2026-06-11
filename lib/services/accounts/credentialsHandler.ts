import { buildCredentialAccount } from '@/lib/services/accounts/credentialAccount'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse } from '@/lib/utils/response'

// Shared read handler for the current actor's CredentialAccount, used by both
// GET /api/v1/accounts/verify_credentials and GET /api/v1/profile.
// The CORS allow-list differs per route (verify_credentials = OPTIONS,GET;
// profile = OPTIONS,GET,PATCH), so it is passed in.
// Scope: read:accounts (satisfied by the aggregate `read`).
export const getCredentialAccountHandler = (corsHeaders: HttpMethod[]) =>
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
          allowedMethods: corsHeaders,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }
      return apiResponse({
        req,
        allowedMethods: corsHeaders,
        data: buildCredentialAccount({ account, followRequestsCount })
      })
    },
    { errorResponse: corsErrorResponse(corsHeaders) }
  )
