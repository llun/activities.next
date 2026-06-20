import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
  account_id: string
}

// A member approves (opts in to) their OWN inclusion in a collection, making
// them visible in the public projection. This is the consent gate: members are
// added as `pending` and only appear publicly once they approve. `account_id`
// in the path is the Mastodon URL shape; the action always targets the
// authenticated caller's own membership.
export const POST = traceApiRoute(
  'approveCollectionMembership',
  OAuthGuard<Params>(
    [Scope.enum['write:collections']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const updated = await database.setOwnCollectionMembershipState({
        collectionId: id,
        actorId: currentActor.id,
        state: 'approved'
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
