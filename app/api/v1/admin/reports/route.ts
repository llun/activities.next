import { NextRequest } from 'next/server'
import { z } from 'zod'

import { serializeAdminReports } from '@/lib/services/admin/serializeAdminReports'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import {
  ERROR_400,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { safeIdToUrl } from '@/lib/utils/urlToId'
import { Booleanish } from '@/lib/utils/zodBooleanish'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

const QueryParams = z.object({
  resolved: Booleanish.optional(),
  account_id: z.string().max(512).optional(),
  target_account_id: z.string().max(512).optional(),
  by_target_domain: z.string().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  max_id: z.string().max(255).optional(),
  since_id: z.string().max(255).optional(),
  min_id: z.string().max(255).optional()
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListReports',
  AdminApiGuard(
    CORS_HEADERS,
    async (req: NextRequest, { database, moderator }) => {
      const parsed = QueryParams.safeParse(
        Object.fromEntries(new URL(req.url).searchParams)
      )
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: HTTP_STATUS.BAD_REQUEST
        })
      }
      const q = parsed.data

      const reports = await database.getAdminReports({
        resolved: q.resolved,
        // account_id/target_account_id are Mastodon account (actor) ids.
        accountId: q.account_id
          ? (safeIdToUrl(q.account_id) ?? undefined)
          : undefined,
        targetActorId: q.target_account_id
          ? (safeIdToUrl(q.target_account_id) ?? undefined)
          : undefined,
        byTargetDomain: q.by_target_domain,
        limit: q.limit,
        maxId: q.max_id,
        minId: q.min_id,
        sinceId: q.since_id
      })
      const entities = await serializeAdminReports(
        database,
        reports,
        moderator.actorId ?? undefined
      )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: entities,
        additionalHeaders: buildPaginationLinkHeader({
          host: headerHost(req.headers),
          path: '/api/v1/admin/reports',
          limit: q.limit,
          nextMaxId:
            reports.length === q.limit ? reports[reports.length - 1].id : null,
          prevMinId: reports.length > 0 ? reports[0].id : null
        })
      })
    },
    { resource: 'reports' }
  )
)
