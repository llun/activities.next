import { buildCredentialAccount } from '@/lib/services/accounts/credentialAccount'
import { localizeAccount } from '@/lib/services/accounts/localizeAccount'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { hasGrantedScope } from '@/lib/services/guards/scopeHierarchy'
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
      const { currentActor, database, grantedScopes } = context
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
      const credentialAccount = buildCredentialAccount({
        account: localizeAccount(account, headerHost(req.headers)),
        followRequestsCount
      })
      // Mastodon's `profile` scope is narrower than read:accounts: it grants
      // verify_credentials but the response OMITS `source` (default posting
      // prefs, raw note, follow_requests_count) and `role`. A token that also
      // holds read/read:accounts — or a cookie session (grantedScopes
      // undefined), which has full access — gets the complete CredentialAccount.
      const hasAccountRead =
        grantedScopes === undefined ||
        hasGrantedScope(grantedScopes, Scope.enum['read:accounts'])
      const {
        source: _source,
        role: _role,
        ...limitedAccount
      } = credentialAccount
      return apiResponse({
        req,
        allowedMethods: corsHeaders,
        data: hasAccountRead ? credentialAccount : limitedAccount
      })
    },
    { errorResponse: corsErrorResponse(corsHeaders) }
  )
