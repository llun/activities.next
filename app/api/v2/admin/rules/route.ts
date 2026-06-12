import { NextRequest } from 'next/server'

import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { RuleCreateInput, getAdminRule } from '@/lib/services/rules/adminRule'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
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
  'adminListInstanceRules',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const rules = await database.getInstanceRules()
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: rules.map(getAdminRule)
    })
  })
)

export const POST = traceApiRoute(
  'adminCreateInstanceRule',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    let rawBody: unknown
    try {
      rawBody = await req.json()
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }
    const parsed = RuleCreateInput.safeParse(rawBody)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const rule = await database.createInstanceRule({
      text: parsed.data.text,
      hint: parsed.data.hint,
      position: parsed.data.position
    })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: getAdminRule(rule)
    })
  })
)
