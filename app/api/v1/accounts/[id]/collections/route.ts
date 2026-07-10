import { getCollectionEntities } from '@/lib/services/collections/serializers'
import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
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

// Parse limit/offset with the upstream defaults (limit 40, max 80; offset 0),
// falling back on non-numeric input rather than erroring (Mastodon clamps).
const parsePaging = (url: URL) => {
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
    Number.isSafeInteger(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0
  return { limit, offset }
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
      const { limit, offset } = parsePaging(url)
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

      const host = headerHost(req.headers)
      const buildLink = (rel: 'next' | 'prev', value: number) =>
        `<https://${host}/api/v1/accounts/${id}/collections?limit=${limit}&offset=${value}>; rel="${rel}"`
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
    },
    { matchMode: 'any' }
  )
)
