import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import { getLocalActorFeaturedTagsCollectionId } from '@/lib/utils/activitypubId'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActorFeaturedTagsCollection',
  OnlyLocalUserGuard(
    async (database, actor, req) => {
      const tags = await database.getFeaturedTags({ actorId: actor.id })
      // AP `Hashtag` items use the actor's canonical domain (not the request
      // Host header) so the document stays internally consistent regardless of
      // how it's fetched. https://docs.joinmastodon.org/spec/activitypub/#Hashtag
      const orderedItems = tags.map((tag) => ({
        type: 'Hashtag',
        href: `https://${actor.domain}/tags/${encodeURIComponent(
          tag.name.toLowerCase()
        )}`,
        name: `#${tag.name}`
      }))

      return activityPubResponse({
        req,
        data: {
          '@context': ACTIVITY_STREAM_URL,
          id: getLocalActorFeaturedTagsCollectionId(actor.id),
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
