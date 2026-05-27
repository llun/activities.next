import { NextRequest } from 'next/server'
import { z } from 'zod'

import { DomainAllowRequest } from '@/app/api/v1/admin/domain_allows/schema'
import { toAdminDomainAllow } from '@/lib/services/federation/domainRules'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
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
  offset: z.coerce.number().int().min(0).default(0)
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListDomainAllows',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
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

    const { limit, offset } = parsedParams.data
    const [allows, stats] = await Promise.all([
      database.getDomainAllows({ limit, offset }),
      database.getDomainFederationRuleStats()
    ])

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: allows.map(toAdminDomainAllow),
      additionalHeaders: [
        ['X-Total-Count', `${stats.allows}`],
        ['X-Offset', `${offset}`],
        ['X-Limit', `${limit}`]
      ]
    })
  })
)

export const POST = traceApiRoute(
  'adminCreateDomainAllow',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
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
  })
)
