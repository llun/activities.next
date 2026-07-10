import { parseAccountCollectionsPaging } from '@/lib/services/collections/accountCollectionsPaging'
import { getCollectionEntities } from '@/lib/services/collections/serializers'
import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildOffsetPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// An account's collections (Mastodon 4.6). Anonymous and non-owner viewers see
// only discoverable (public-visibility) collections in the public projection;
// the owner sees every collection with all consent states.
export const GET = traceApiRoute(
  'getAccountCollections',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:collections']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const ownerActorId = idToUrl(id)
      const url = new URL(req.url)
      const { limit, offset } = parseAccountCollectionsPaging(url)
      const isOwner = currentActor?.id === ownerActorId

      const collections = await database.getAccountCollections({
        ownerActorId,
        publicOnly: !isOwner,
        limit,
        offset
      })
      const entities = await getCollectionEntities(
        database,
        collections,
        isOwner ? 'owner' : 'public'
      )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { collections: entities },
        additionalHeaders: buildOffsetPaginationLinkHeader({
          host: headerHost(req.headers),
          path: `/api/v1/accounts/${id}/collections`,
          limit,
          offset,
          hasNext: entities.length === limit
        })
      })
    },
    { matchMode: 'any' }
  )
)
