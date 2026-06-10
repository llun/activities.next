import { NextRequest } from 'next/server'

import {
  parseFilterBody,
  parseFilterUpdateInput
} from '@/lib/services/filters/parseFilterInput'
import { AdminApiGuard } from '@/lib/services/guards/AdminApiGuard'
import {
  getMastodonServerFilter,
  getMastodonServerFilterFromRecord
} from '@/lib/services/mastodon/getMastodonFilter'
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
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT,
  HttpMethod.enum.PATCH,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'adminGetServerFilter',
  AdminApiGuard<Params>(CORS_HEADERS, async (req, { database, params }) => {
    const { id } = await params
    const keywords = await database.getServerFilterKeywords({ id })
    const filter = await database.getServerFilter({ id })
    if (!filter || !keywords)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    const data = getMastodonServerFilterFromRecord({ filter, keywords })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
  })
)

export const PUT = traceApiRoute(
  'adminUpdateServerFilter',
  AdminApiGuard<Params>(
    CORS_HEADERS,
    async (req: NextRequest, { database, params }) => {
      const { id } = await params
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
      const input = parseFilterUpdateInput(rawBody)
      if (!input)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })

      const updated = await database.updateServerFilter({
        id,
        title: input.title,
        context: input.context,
        filterAction: input.filterAction,
        expiresAt: input.expiresAt,
        keywords: input.keywords
      })
      if (!updated)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      const data = await getMastodonServerFilter(database, updated)
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    }
  )
)

// Mastodon clients commonly send PATCH for updates; bind it to the same handler.
export const PATCH = PUT

export const DELETE = traceApiRoute(
  'adminDeleteServerFilter',
  AdminApiGuard<Params>(CORS_HEADERS, async (req, { database, params }) => {
    const { id } = await params
    const deleted = await database.deleteServerFilter({ id })
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
