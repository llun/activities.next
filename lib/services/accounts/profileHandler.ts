import { buildProfile } from '@/lib/services/accounts/profile'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse } from '@/lib/utils/response'

// Read handler for GET /api/v1/profile: returns the Mastodon 4.6 Profile
// entity (raw field values, nullable avatar/header) rather than the
// CredentialAccount that verify_credentials returns.
// https://docs.joinmastodon.org/methods/profile/#get
// Scope: `profile` or read:accounts (satisfied by the aggregate `read`),
// matching the documented "profile or read:accounts" requirement.
export const getProfileHandler = (corsHeaders: HttpMethod[]) =>
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:accounts'], Scope.enum.profile],
    async (req, context) => {
      const { currentActor, database } = context
      const [account, settings] = await Promise.all([
        database.getMastodonActorFromId({ id: currentActor.id }),
        database.getActorSettings({ actorId: currentActor.id })
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
        data: buildProfile({ account, settings })
      })
    },
    { errorResponse: corsErrorResponse(corsHeaders) }
  )
