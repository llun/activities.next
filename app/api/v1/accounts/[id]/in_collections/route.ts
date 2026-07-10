import { parseAccountCollectionsPaging } from '@/lib/services/collections/accountCollectionsPaging'
import { getCollectionEntities } from '@/lib/services/collections/serializers'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
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

// ALL collections featuring the given account that the caller may see
// (Mastodon 4.6 `in_collections`, auth required): the caller's own collections
// regardless of visibility/consent state, plus other owners' public
// collections where the account has approved (consented to) the inclusion —
// pending/revoked memberships never leak across owners. Collections the
// caller owns are serialized in the owner projection; everyone else's in the
// public projection.
export const GET = traceApiRoute(
  'getAccountInCollections',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:collections']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const url = new URL(req.url)
      const { limit, offset } = parseAccountCollectionsPaging(url)

      const collections = await database.getCollectionsFeaturingAccount({
        targetActorId: idToUrl(id),
        viewerActorId: currentActor.id,
        limit,
        offset
      })
      const owned = collections.filter(
        (collection) => collection.ownerActorId === currentActor.id
      )
      const others = collections.filter(
        (collection) => collection.ownerActorId !== currentActor.id
      )
      const [ownedEntities, otherEntities] = await Promise.all([
        getCollectionEntities(database, owned, 'owner'),
        getCollectionEntities(database, others, 'public')
      ])
      const entitiesById = new Map(
        [...ownedEntities, ...otherEntities].map((entity) => [
          entity.id,
          entity
        ])
      )
      const entities = collections.flatMap((collection) => {
        const entity = entitiesById.get(collection.id)
        return entity ? [entity] : []
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { collections: entities },
        additionalHeaders: buildOffsetPaginationLinkHeader({
          host: headerHost(req.headers),
          path: `/api/v1/accounts/${id}/in_collections`,
          limit,
          offset,
          hasNext: entities.length === limit
        })
      })
    }
  )
)
