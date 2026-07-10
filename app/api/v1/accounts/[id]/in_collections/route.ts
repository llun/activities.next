import { getCollectionEntities } from '@/lib/services/collections/serializers'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 80

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
      const parsedLimit = parseInt(
        url.searchParams.get('limit') ?? `${DEFAULT_LIMIT}`,
        10
      )
      const limit =
        Number.isSafeInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, MAX_LIMIT)
          : DEFAULT_LIMIT
      const parsedOffset = parseInt(url.searchParams.get('offset') ?? '0', 10)
      const offset =
        Number.isSafeInteger(parsedOffset) && parsedOffset > 0
          ? parsedOffset
          : 0

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

      const host = headerHost(req.headers)
      const buildLink = (rel: 'next' | 'prev', value: number) =>
        `<https://${host}/api/v1/accounts/${id}/in_collections?limit=${limit}&offset=${value}>; rel="${rel}"`
      const links = [
        entities.length === limit ? buildLink('next', offset + limit) : null,
        offset > 0 ? buildLink('prev', Math.max(offset - limit, 0)) : null
      ]
        .filter(Boolean)
        .join(', ')

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { collections: entities },
        additionalHeaders: [
          ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
        ]
      })
    }
  )
)
