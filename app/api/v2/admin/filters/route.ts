import { NextRequest } from 'next/server'

import {
  parseFilterBody,
  parseFilterCreateInput
} from '@/lib/services/filters/parseFilterInput'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import {
  getMastodonServerFilter,
  getMastodonServerFilterFromRecord
} from '@/lib/services/mastodon/getMastodonFilter'
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
  'adminListServerFilters',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    const records = await database.getServerFilterRecords()
    const data = records.map(getMastodonServerFilterFromRecord)
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
  })
)

export const POST = traceApiRoute(
  'adminCreateServerFilter',
  AdminApiGuard(CORS_HEADERS, async (req: NextRequest, { database }) => {
    let rawBody: unknown
    try {
      rawBody = await parseFilterBody(req)
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }
    const input = parseFilterCreateInput(rawBody)
    if (!input) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
      })
    }

    const filter = await database.createServerFilter({
      title: input.title,
      context: input.context,
      filterAction: input.filterAction,
      expiresAt: input.expiresAt,
      keywords: input.keywords
    })
    const data = await getMastodonServerFilter(database, filter)
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
  })
)
