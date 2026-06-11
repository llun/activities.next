import { z } from 'zod'

import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { toMastodonScheduledStatus } from '@/lib/services/statuses/scheduledStatusSerializer'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 40

export const OPTIONS = defaultOptions(CORS_HEADERS)

const QuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  max_id: z.string().optional(),
  min_id: z.string().optional(),
  since_id: z.string().optional()
})

// https://docs.joinmastodon.org/methods/scheduled_statuses/#get
// Owner-scoped list of the actor's pending scheduled statuses, paginated with
// Mastodon's id keyset cursors. read:statuses scope (matching the /:id route).
export const GET = traceApiRoute(
  'getScheduledStatuses',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, { database, currentActor }) => {
      const url = new URL(req.url)
      const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams))
      const query = parsed.success ? parsed.data : {}
      const limit = query.limit ?? DEFAULT_LIMIT

      const scheduledStatuses = await database.getScheduledStatuses({
        actorId: currentActor.id,
        limit,
        maxId: query.max_id,
        minId: query.min_id,
        sinceId: query.since_id
      })

      const data = await Promise.all(
        scheduledStatuses.map((scheduled) =>
          toMastodonScheduledStatus(
            database,
            scheduled,
            currentActor.account?.id
          )
        )
      )

      const additionalHeaders = buildPaginationLinkHeader({
        host: headerHost(req.headers),
        path: '/api/v1/scheduled_statuses',
        limit,
        nextMaxId:
          scheduledStatuses.length === limit
            ? scheduledStatuses[scheduledStatuses.length - 1].id
            : null,
        prevMinId: scheduledStatuses.length > 0 ? scheduledStatuses[0].id : null
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data,
        additionalHeaders
      })
    }
  )
)
