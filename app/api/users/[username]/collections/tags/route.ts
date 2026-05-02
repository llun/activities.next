import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActorFeaturedTagsCollection',
  OnlyLocalUserGuard(
    async (_database, actor, req) =>
      activityPubResponse({
        req,
        data: {
          '@context': ACTIVITY_STREAM_URL,
          id: `${actor.id}/collections/tags`,
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
