import { getFeaturedCollection } from '@/lib/activities/getFeaturedCollection'
import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// FEP-7aa9: an individual FeaturedCollection object (a curated set of accounts).
// Only `public` collections are federated; private/unlisted (and unknown ids)
// return 404. Items are the approved members — consent is enforced by the
// storage layer, so pending/revoked members never appear here.
export const GET = traceApiRoute(
  'getActorFeaturedCollection',
  OnlyLocalUserGuard(
    async (database, actor, req, query) => {
      const { id } = (await query.params) as { username: string; id: string }
      const collection = await database.getCollection({ id, actorId: actor.id })
      if (!collection || collection.visibility !== 'public') {
        return apiErrorResponse(404)
      }

      const members = await database.getApprovedCollectionMembers({
        id,
        actorId: actor.id
      })

      return activityPubResponse({
        req,
        data: getFeaturedCollection(actor.id, collection, members)
      })
    },
    {
      allowFederationSigningActor: true
    }
  )
)
