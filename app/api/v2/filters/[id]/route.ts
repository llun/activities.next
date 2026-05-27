import { NextRequest } from 'next/server'

import {
  parseFilterBody,
  parseFilterUpdateInput
} from '@/lib/services/filters/parseFilterInput'
import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonFilter } from '@/lib/services/mastodon/getMastodonFilter'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getFilter',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:filters']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const filter = await database.getFilter({
        actorId: currentActor.id,
        id
      })
      if (!filter) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      const data = await getMastodonFilter(database, filter)
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    }
  )
)

export const PUT = traceApiRoute(
  'updateFilter',
  OAuthGuard<Params>(
    [Scope.enum['write:filters']],
    async (req: NextRequest, { database, currentActor, params }) => {
      const { id } = await params
      let rawBody: unknown
      try {
        rawBody = await parseFilterBody(req)
      } catch {
        return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      }
      const input = parseFilterUpdateInput(rawBody)
      if (!input) return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)

      const updated = await database.updateFilter({
        actorId: currentActor.id,
        id,
        title: input.title,
        context: input.context,
        filterAction: input.filterAction,
        expiresAt: input.expiresAt,
        keywords: input.keywords
      })
      if (!updated) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      const data = await getMastodonFilter(database, updated)
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    }
  )
)

export const DELETE = traceApiRoute(
  'deleteFilter',
  OAuthGuard<Params>(
    [Scope.enum['write:filters']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const deleted = await database.deleteFilter({
        actorId: currentActor.id,
        id
      })
      if (!deleted) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
