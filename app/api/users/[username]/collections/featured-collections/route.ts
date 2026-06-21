import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import {
  getLocalActorFeaturedCollectionsId,
  getLocalFeaturedCollectionId
} from '@/lib/utils/activitypubId'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// FEP-7aa9: the actor's `featuredCollections` endpoint — an OrderedCollection
// listing the ids of the actor's PUBLIC FeaturedCollection objects. Only
// `public` collections are federated here; `unlisted`/`private` are not surfaced.
export const GET = traceApiRoute(
  'getActorFeaturedCollections',
  OnlyLocalUserGuard(
    async (database, actor, req) => {
      const collections = await database.getCollections({ actorId: actor.id })
      const orderedItems = collections
        .filter((collection) => collection.visibility === 'public')
        .map((collection) =>
          getLocalFeaturedCollectionId(actor.id, collection.id)
        )

      return activityPubResponse({
        req,
        data: {
          '@context': ACTIVITY_STREAM_URL,
          id: getLocalActorFeaturedCollectionsId(actor.id),
          type: 'OrderedCollection',
          totalItems: orderedItems.length,
          orderedItems
        }
      })
    },
    {
      allowFederationSigningActor: true
    }
  )
)
