import { NextRequest } from 'next/server'

import {
  parseFilterBody,
  parseFilterCreateInput
} from '@/lib/services/filters/parseFilterInput'
import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import {
  getMastodonFilter,
  getMastodonFilters
} from '@/lib/services/mastodon/getMastodonFilter'
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
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'listFilters',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:filters']],
    async (req, { database, currentActor }) => {
      const filters = await database.getFilters({ actorId: currentActor.id })
      const data = await getMastodonFilters(database, filters)
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    }
  )
)

export const POST = traceApiRoute(
  'createFilter',
  OAuthGuard(
    [Scope.enum['write:filters']],
    async (req: NextRequest, { database, currentActor }) => {
      let rawBody: unknown
      try {
        rawBody = await parseFilterBody(req)
      } catch {
        return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      }
      const input = parseFilterCreateInput(rawBody)
      if (!input) {
        return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      }

      const filter = await database.createFilter({
        actorId: currentActor.id,
        title: input.title,
        context: input.context,
        filterAction: input.filterAction,
        expiresAt: input.expiresAt,
        keywords: input.keywords
      })
      const data = await getMastodonFilter(database, filter)
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    }
  )
)
