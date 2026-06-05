import { z } from 'zod'

import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { buildAccountCursorLinkHeader } from '@/lib/services/mastodon/accountCursorLinkHeader'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const RebloggedByQueryParams = z.object({
  limit: z.coerce.number().int().min(1).max(80).default(40),
  max_id: z.string().min(1).optional(),
  since_id: z.string().min(1).optional()
})

export const GET = traceApiRoute(
  'getStatusRebloggedBy',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

      const queryParams = Object.fromEntries(new URL(req.url).searchParams)
      const parsedParams = RebloggedByQueryParams.safeParse(queryParams)
      if (!parsedParams.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const { limit, max_id: maxId, since_id: sinceId } = parsedParams.data
      const statusId = idToUrl(encodedStatusId)
      const status = await getReadableStatus({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

      const reblogsPage = await database.getRebloggedBy({
        statusId,
        limit: limit + 1,
        maxStatusId: maxId ? idToUrl(maxId) : undefined,
        sinceStatusId: sinceId ? idToUrl(sinceId) : undefined,
        visibleToActorId: currentActor?.id ?? null
      })
      const hasNextPage = reblogsPage.length > limit
      const reblogs = reblogsPage.slice(0, limit)

      const paginationLink = buildAccountCursorLinkHeader({
        req,
        limit,
        items: reblogs,
        hasNextPage,
        toCursor: (reblog) => urlToId(reblog.statusId)
      })

      const accounts = await database.getMastodonActorsFromIds({
        ids: reblogs.map(({ actorId }) => actorId)
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: accounts,
        additionalHeaders: paginationLink ? [['Link', paginationLink]] : []
      })
    },
    // read or read:accounts satisfies the requirement (Mastodon's
    // reblogged_by_accounts scope), consistent with favourited_by.
    { matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
