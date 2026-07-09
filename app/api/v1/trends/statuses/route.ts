import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import {
  normalizeTrendsOffset,
  normalizeTrendsStatusesLimit
} from '@/lib/services/trends/request'
import { getTrendingStatuses } from '@/lib/services/trends/trendingStatuses'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/trends/#statuses
// Local trends computed live from public interactions (favourites, boosts,
// and replies) on this instance over the last seven days.
export const GET = traceApiRoute(
  'getTrendingStatuses',
  OptionalOAuthGuard(
    [Scope.enum.read],
    async (req, { database, currentActor }) => {
      const searchParams = new URL(req.url).searchParams
      const limit = normalizeTrendsStatusesLimit(searchParams.get('limit'))
      const offset = normalizeTrendsOffset(searchParams.get('offset'))

      const statuses = await getTrendingStatuses({ database, limit, offset })
      // Same serialization path as the timeline routes: batch-prefetches the
      // viewer flags (favourited/reblogged/bookmarked) and preserves the
      // ranked order.
      const mastodonStatuses = await getMastodonStatuses(
        database,
        statuses,
        currentActor?.id
      )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatuses
      })
    }
  )
)
