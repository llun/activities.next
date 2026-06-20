import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getMastodonCollection } from '@/lib/services/mastodon/getMastodonCollection'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// The collections owned by the authenticated actor that contain the given
// account (Mastodon 4.6 `in_collections`).
export const GET = traceApiRoute(
  'getAccountInCollections',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:collections']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const collections = await database.getCollectionsWithAccount({
        actorId: currentActor.id,
        targetActorId: idToUrl(id)
      })
      const sizes = await database.getCollectionMemberCounts({
        actorId: currentActor.id,
        collectionIds: collections.map((collection) => collection.id),
        approvedOnly: true
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: collections.map((collection) =>
          getMastodonCollection(collection, sizes[collection.id] ?? 0)
        )
      })
    }
  )
)
