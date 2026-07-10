import { resolveCollectionItem } from '@/lib/services/collections/resolveCollectionItem'
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

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
  item_id: string
}

// A member revokes their OWN inclusion in a collection (consent opt-out). The
// membership is hidden from the public projection but retained in the owner's
// private feed. Mastodon 4.6 addresses the membership by its CollectionItem
// id; the segment also accepts the member's Account id as an activities.next
// extension (the first-party UI uses that form). The resolved membership must
// belong to the authenticated caller — anyone else's item is rejected with
// 403, and an unknown item answers 404.
export const POST = traceApiRoute(
  'revokeCollectionMembership',
  OAuthGuard<Params>(
    [Scope.enum['write:collections']],
    async (req, { database, currentActor, params }) => {
      const { id, item_id } = await params
      const item = await resolveCollectionItem(database, id, item_id)
      if (!item) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      if (item.targetActorId !== currentActor.id) {
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
