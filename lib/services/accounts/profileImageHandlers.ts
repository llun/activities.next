import { buildCredentialAccount } from '@/lib/services/accounts/credentialAccount'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiCorsError, apiResponse } from '@/lib/utils/response'

export const PROFILE_IMAGE_CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.DELETE
]

const guardOptions = {
  errorResponse: corsErrorResponse(PROFILE_IMAGE_CORS_HEADERS)
}

/**
 * Returns a DELETE handler that clears either the avatar (iconUrl) or header
 * image (headerImageUrl) for the current actor and returns the updated
 * CredentialAccount.
 *
 * Used by:
 *   DELETE /api/v1/profile/avatar  — https://docs.joinmastodon.org/methods/profile/#delete-profile-avatar
 *   DELETE /api/v1/profile/header  — https://docs.joinmastodon.org/methods/profile/#delete-profile-header
 */
export const deleteProfileImageHandler = (
  field: 'iconUrl' | 'headerImageUrl'
) =>
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:accounts']],
    async (req, context) => {
      const { currentActor, database } = context
      await database.updateActor({
        actorId: currentActor.id,
        ...(field === 'iconUrl' ? { iconUrl: null } : { headerImageUrl: null })
      })
      const [account, followRequestsCount] = await Promise.all([
        database.getMastodonActorFromId({ id: currentActor.id }),
        database.getFollowRequestsCount({ targetActorId: currentActor.id })
      ])
      if (!account) {
        logger.error({ message: 'deleteProfileImage: actor not found' })
        return apiCorsError(req, PROFILE_IMAGE_CORS_HEADERS, 500)
      }
      return apiResponse({
        req,
        allowedMethods: PROFILE_IMAGE_CORS_HEADERS,
        data: buildCredentialAccount({ account, followRequestsCount })
      })
    },
    guardOptions
  )
