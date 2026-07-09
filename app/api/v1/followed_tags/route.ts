import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonTag } from '@/lib/services/mastodon/getMastodonTag'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/followed_tags/
export const GET = traceApiRoute(
  'getFollowedTags',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:follows']],
    async (req, { database, currentActor }) => {
      const url = new URL(req.url)
      const parsedLimit = parseInt(
        url.searchParams.get('limit') ?? `${DEFAULT_LIMIT}`,
        10
      )
      const limit =
        Number.isSafeInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, MAX_LIMIT)
          : DEFAULT_LIMIT

      const followedTags = await database.getFollowedTags({
        actorId: currentActor.id,
        limit,
        maxId: url.searchParams.get('max_id'),
        minId: url.searchParams.get('min_id'),
        sinceId: url.searchParams.get('since_id')
      })

      // Cursor conventions shared with the other paginated Mastodon routes:
      // `next` when the page is full (there may be older rows), `prev`
      // whenever the page has rows (newer rows may have appeared since).
      const lastTag = followedTags[followedTags.length - 1]
      const additionalHeaders = buildPaginationLinkHeader({
        host: headerHost(req.headers),
        path: '/api/v1/followed_tags',
        limit,
        nextMaxId: followedTags.length === limit && lastTag ? lastTag.id : null,
        prevMinId: followedTags.length > 0 ? followedTags[0].id : null
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: followedTags.map((tag) => getMastodonTag(tag.name, true)),
        additionalHeaders
      })
    }
  )
)
