import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import { getLocalActorFeaturedCollectionId } from '@/lib/utils/activitypubId'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActorFeaturedCollection',
  OnlyLocalUserGuard(
    async (_database, actor, req) =>
      activityPubResponse({
        req,
        data: {
          '@context': ACTIVITY_STREAM_URL,
          id: getLocalActorFeaturedCollectionId(actor.id),
          type: 'OrderedCollection',
          totalItems: 0,
          orderedItems: []
        }
      }),
    {
      allowFederationSigningActor: true
    }
  )
)
