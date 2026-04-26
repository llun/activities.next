import { NextRequest } from 'next/server'

import {
  DomainAllowRequest,
  readRequestData
} from '@/app/api/v1/admin/domain_allows/schema'
import { toAdminDomainAllow } from '@/lib/services/federation/domainRules'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
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

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListDomainAllows',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const allows = await database.getDomainAllows({ limit: 10_000 })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: allows.map(toAdminDomainAllow)
    })
  })
)

export const POST = traceApiRoute(
  'adminCreateDomainAllow',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    let data: unknown
    try {
      data = await readRequestData(req)
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
