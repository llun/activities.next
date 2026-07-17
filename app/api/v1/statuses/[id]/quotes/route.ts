import { z } from 'zod'

import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { buildAccountCursorLinkHeader } from '@/lib/services/mastodon/accountCursorLinkHeader'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// Mastodon caps this at 40, default 20.
const QuerySchema = z.object({
  limit: clampedLimit(40, 20),
  max_id: z.string().min(1).optional(),
  since_id: z.string().min(1).optional()
})

// GET /api/v1/statuses/:id/quotes — the accepted quotes of a status, newest
// first. Only `accepted` edges are listed (pending/rejected/revoked/deleted are
// never public). 404 when the quoted status is not visible to the caller.
export const GET = traceApiRoute(
  'getStatusQuotes',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)
      const statusId = idToUrl(encodedStatusId)

      const status = await getReadableStatus({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)

      const query = QuerySchema.safeParse(
        Object.fromEntries(new URL(req.url).searchParams)
      )
      if (!query.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid request' },
          responseStatusCode: 400
        })
      }
      const { limit, max_id: maxId, since_id: sinceId } = query.data

      // Fetch one extra to detect an older page for the `next` link.
      const quotingIds = await database.getQuotingStatusIds({
        quotedStatusId: statusId,
        state: 'accepted',
        limit: limit + 1,
        maxId: maxId ? idToUrl(maxId) : undefined,
        sinceId: sinceId ? idToUrl(sinceId) : undefined
      })
      const hasOverflow = quotingIds.length > limit
      const pageIds = quotingIds.slice(0, limit)

      const statuses = await database.getStatusesByIds({
        statusIds: pageIds,
        currentActorId: currentActor?.id
      })
      const mastodonStatuses = await getMastodonStatuses(
        database,
        statuses,
        currentActor?.id
      )

      const paginationLink = buildAccountCursorLinkHeader({
        req,
        limit,
        items: mastodonStatuses,
        hasNext: hasOverflow,
        hasPrev: Boolean(maxId || sinceId),
        // Mastodon status ids are already the urlToId-encoded form.
        toCursor: (status) => status.id
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatuses,
        additionalHeaders: paginationLink ? [['Link', paginationLink]] : []
      })
    },
    { matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
