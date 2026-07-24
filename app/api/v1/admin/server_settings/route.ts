import { NextRequest } from 'next/server'

import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import {
  getServerSettingsView,
  updateServerSettings
} from '@/lib/services/serverSettings'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// Read/write the database-backed server settings. Same-origin admin surface
// (the admin settings pages) — guarded by the admin role + the aggregate
// admin:read / admin:write scopes; env-pinned fields are reported locked and
// reject writes.
const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PATCH
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'adminGetServerSettings',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const view = await getServerSettingsView(database)
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { settings: view.settings, locks: view.locks }
    })
  })
)

export const PATCH = traceApiRoute(
  'adminUpdateServerSettings',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    let body: Record<string, unknown>
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

    const result = await updateServerSettings(database, body)
    if (!result.applied) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          error: 'Some settings could not be saved',
          rejected: result.rejected
        },
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { settings: result.view.settings, locks: result.view.locks }
    })
  })
)
