import { NextRequest } from 'next/server'
import { z } from 'zod'

import { DomainAllowRequest } from '@/app/api/v1/admin/domain_allows/schema'
import { toAdminDomainAllow } from '@/lib/services/federation/domainRules'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import {
  ERROR_400,
  ERROR_422,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]
const DomainRuleListQueryParams = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  max_id: z.string().max(255).optional(),
  since_id: z.string().max(255).optional(),
  min_id: z.string().max(255).optional()
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListDomainAllows',
  AdminApiGuard(
    CORS_HEADERS,
    async (req: NextRequest, { database }) => {
      const queryParams = Object.fromEntries(new URL(req.url).searchParams)
      const parsedParams = DomainRuleListQueryParams.safeParse(queryParams)
      if (!parsedParams.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: HTTP_STATUS.BAD_REQUEST
        })
      }

      const {
        limit,
        offset,
        max_id: maxId,
        since_id: sinceId,
        min_id: minId
      } = parsedParams.data
      const hasCursor = Boolean(maxId || sinceId || minId)
      const [allows, stats] = await Promise.all([
        database.getDomainAllows({ limit, offset, maxId, minId, sinceId }),
        database.getDomainFederationRuleStats()
      ])

      const additionalHeaders: [string, string][] = [
        ...buildPaginationLinkHeader({
          host: headerHost(req.headers),
          path: '/api/v1/admin/domain_allows',
          limit,
          nextMaxId:
            allows.length === limit ? allows[allows.length - 1].id : null,
          prevMinId: allows.length > 0 ? allows[0].id : null
        }),
        // The offset/X-Total-Count listing is kept as an extension for the
        // admin UI when no cursor parameter is used.
        ...(hasCursor
          ? []
          : ([
              ['X-Total-Count', `${stats.allows}`],
              ['X-Offset', `${offset}`],
              ['X-Limit', `${limit}`]
            ] as [string, string][]))
      ]

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: allows.map(toAdminDomainAllow),
        additionalHeaders
      })
    },
    { resource: 'domain_allows' }
  )
)

export const POST = traceApiRoute(
  'adminCreateDomainAllow',
  AdminApiGuard(
    CORS_HEADERS,
    async (req: NextRequest, { database }) => {
      let data: unknown
      try {
        data = await getRequestBody(req)
      } catch {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: HTTP_STATUS.BAD_REQUEST
        })
      }

      const parsed = DomainAllowRequest.safeParse(data)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }

      const allow = await database.createDomainAllow({
        domain: parsed.data.domain
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: toAdminDomainAllow(allow)
      })
    },
    { resource: 'domain_allows' }
  )
)
