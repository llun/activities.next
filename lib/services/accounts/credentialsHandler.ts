import { buildCredentialAccount } from '@/lib/services/accounts/credentialAccount'
import { localizeAccount } from '@/lib/services/accounts/localizeAccount'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
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
    [Scope.enum.read, Scope.enum['read:accounts'], Scope.enum.profile],
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
      // Render the current user's acct relative to the domain they connected
      // through, so a client on a non-ACTIVITIES_HOST domain sees its own
      // account as local (bare acct) rather than as a foreign one.
      return apiResponse({
        req,
        allowedMethods: corsHeaders,
        data: buildCredentialAccount({
          account: localizeAccount(account, headerHost(req.headers)),
          followRequestsCount
        })
      })
    },
    { errorResponse: corsErrorResponse(corsHeaders) }
  )
