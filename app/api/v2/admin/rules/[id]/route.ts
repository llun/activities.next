import { NextRequest } from 'next/server'

import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import { RuleUpdateInput, getAdminRule } from '@/lib/services/rules/adminRule'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.PUT,
  HttpMethod.enum.PATCH,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const PUT = traceApiRoute(
  'adminUpdateInstanceRule',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req: NextRequest, { database, params }) => {
      const { id } = await params
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
      const parsed = RuleUpdateInput.safeParse(rawBody)
      if (!parsed.success)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })

      const updated = await database.updateInstanceRule({
        id,
        text: parsed.data.text,
        hint: parsed.data.hint,
        position: parsed.data.position
      })
      if (!updated)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getAdminRule(updated)
      })
    }
  )
)

// Mastodon clients commonly send PATCH for updates; bind it to the same handler.
export const PATCH = PUT

export const DELETE = traceApiRoute(
  'adminDeleteInstanceRule',
  AdminApiGuard<Params>(CORS_HEADERS, async (req, { database, params }) => {
    const { id } = await params
    const deleted = await database.deleteInstanceRule({ id })
    if (!deleted)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
  })
)
