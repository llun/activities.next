import { resolveCollectionItem } from '@/lib/services/collections/resolveCollectionItem'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
  item_id: string
}

// A member approves (opts in to) their OWN inclusion in a collection, making
// them visible in the public projection. This is the consent gate: members are
// added as `pending` and only appear publicly once they approve. Mastodon 4.6
// addresses the membership by its CollectionItem id; the segment also accepts
// the member's Account id as an activities.next extension (the first-party UI
// uses that form). The resolved membership must belong to the authenticated
// caller. Any token with write:collections can reach this route, so acting on
// someone else's membership answers 404 — indistinguishable from an unknown
// item — rather than 403: a 403/404 split would let a stranger who knows the
// collection id probe whether an arbitrary account is a pending/revoked/approved
// member, defeating the consent-hiding and private-collection existence-hiding.
export const POST = traceApiRoute(
  'approveCollectionMembership',
  OAuthGuard<Params>(
    [Scope.enum['write:collections']],
    async (req, { database, currentActor, params }) => {
      const { id, item_id } = await params
      const item = await resolveCollectionItem(database, id, item_id)
      if (!item || item.targetActorId !== currentActor.id) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
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
