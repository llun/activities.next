import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
// Mastodon's documented default/maximum page size for follow_requests.
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 80

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getFollowRequests',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:follows']],
    async (req, { database, currentActor }) => {
      const url = new URL(req.url)
      const parsedLimit = parseInt(
        url.searchParams.get('limit') || `${DEFAULT_LIMIT}`,
        10
      )
      const limit =
        Number.isSafeInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, MAX_LIMIT)
          : DEFAULT_LIMIT

      const followRequests = await database.getFollowRequests({
        targetActorId: currentActor.id,
        limit,
        maxId: url.searchParams.get('max_id'),
        minId: url.searchParams.get('min_id'),
        sinceId: url.searchParams.get('since_id')
      })

      // Batch-hydrate the requesters in a single query (matching the mutes
      // route). Drop any requester whose actor cannot be hydrated, but compute
      // the Link cursors from the follow rows (not the filtered accounts) so
      // pagination stays correct.
      const requesterIds = followRequests.map((follow) => follow.actorId)
      const hydratedAccounts =
        requesterIds.length > 0
          ? await database.getMastodonActorsFromIds({ ids: requesterIds })
          : []
      const accountsByUrl = new Map(
        hydratedAccounts.map((account) => [account.url, account])
      )
      const accounts = followRequests
        .map((follow) => accountsByUrl.get(follow.actorId))
        .filter(Boolean)

      const additionalHeaders = buildPaginationLinkHeader({
        host: headerHost(req.headers),
        path: '/api/v1/follow_requests',
        limit,
        nextMaxId:
          followRequests.length === limit
            ? followRequests[followRequests.length - 1].id
            : null,
        prevMinId: followRequests.length > 0 ? followRequests[0].id : null
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: accounts,
        additionalHeaders
      })
    }
  )
)
