import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActorFollowers',
  OnlyLocalUserGuard(
    async (database, actor, req) => {
      const followerId = `${actor.id}/followers`

      const totalItems = await database.getActorFollowersCount({
        actorId: actor.id
      })
      return activityPubResponse({
        req,
        data: {
          '@context': ACTIVITY_STREAM_URL,
          id: followerId,
          type: 'OrderedCollection',
          totalItems
        }
      })
    },
    {
      allowFederationSigningActor: true
    }
  )
)
