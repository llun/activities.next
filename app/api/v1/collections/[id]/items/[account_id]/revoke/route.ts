import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_403,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
  account_id: string
}

// A member revokes their OWN inclusion in a collection (consent opt-out). The
// membership is hidden from the public projection but retained in the owner's
// private feed. The path `account_id` must resolve to the authenticated caller
// (members may only act on their own membership); a mismatch is rejected with
// 403.
export const POST = traceApiRoute(
  'revokeCollectionMembership',
  OAuthGuard<Params>(
    [Scope.enum['write:collections']],
    async (req, { database, currentActor, params }) => {
      const { id, account_id } = await params
      if (idToUrl(account_id) !== currentActor.id) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_403,
          responseStatusCode: 403
        })
      }
      const updated = await database.setOwnCollectionMembershipState({
        collectionId: id,
        actorId: currentActor.id,
        state: 'revoked'
      })
      if (!updated) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
