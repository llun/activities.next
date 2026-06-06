import { getFavouritedStatusesPage } from '@/lib/services/favourites/getFavouritedStatusesPage'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { TimelineFormat } from '@/lib/services/timelines/const'
import { Scope } from '@/lib/types/database/operations'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 40

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getFavourites',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:favourites']],
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
      const format = url.searchParams.get('format')

      const { statuses, nextMaxFavouriteId, prevMinFavouriteId } =
        await getFavouritedStatusesPage({
          database,
          actorId: currentActor.id,
          currentActor,
          limit,
          maxId: url.searchParams.get('max_id'),
          minId: url.searchParams.get('min_id'),
          sinceId: url.searchParams.get('since_id')
        })

      if (format === TimelineFormat.enum.activities_next) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            statuses: statuses.map((status) => cleanJson(status)),
            nextMaxFavouriteId,
            prevMinFavouriteId
          }
        })
      }

      const mastodonStatuses = await getMastodonStatuses(
        database,
        statuses,
        currentActor.id
      )

      const additionalHeaders = buildPaginationLinkHeader({
        host: headerHost(req.headers),
        path: '/api/v1/favourites',
        limit,
        nextMaxId: nextMaxFavouriteId,
        prevMinId: prevMinFavouriteId
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatuses,
        additionalHeaders
      })
    }
  )
)
