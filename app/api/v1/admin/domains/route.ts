import { NextRequest } from 'next/server'

import { AddDomainRequest } from '@/app/api/v1/admin/domains/schema'
import { ADD_DOMAIN_ERROR_MESSAGES } from '@/lib/services/domains/adminDomainTypes'
import {
  addDomain,
  getAdminDomainList
} from '@/lib/services/domains/adminDomains'
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

// Admin › Served domains: the domains this server answers on. GET lists the primary,
// the ACTIVITIES_TRUSTED_HOSTS entries (locked) and the domains an admin added;
// POST adds one, runs the reachability check and saves it as off.
const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminListDomains',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const list = await getAdminDomainList(database)
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: list })
  })
)

export const POST = traceApiRoute(
  'adminAddDomain',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    let body: unknown
    try {
      body = await getRequestBody(req)
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    const parsed = AddDomainRequest.safeParse(body)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const result = await addDomain(database, parsed.data.domain)
    if (result.type === 'error') {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          error: ADD_DOMAIN_ERROR_MESSAGES[result.error],
          code: result.error
        },
        responseStatusCode:
          result.error === 'exists'
            ? HTTP_STATUS.CONFLICT
            : HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: result.domain
    })
  })
)
