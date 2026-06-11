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
  getMastodonFilterFromRecord,
  getMastodonServerFilterFromRecord
} from '@/lib/services/mastodon/getMastodonFilter'
import { Scope } from '@/lib/types/database/operations'
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
  'listFilters',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:filters']],
    async (req, { database, currentActor }) => {
      // The actor's own filters, including expired ones, so the management UI
      // can list them with an "Expired" badge and let the user reactivate them.
      const [ownRecords, serverRecords] = await Promise.all([
        database.getFilterRecordsForActor({ actorId: currentActor.id }),
        // Active instance-wide rules, merged in flagged read-only so clients
        // apply them natively (server filters never expose expired entries).
        database.getActiveServerFilters()
      ])
      const data = [
        ...ownRecords.map(getMastodonFilterFromRecord),
        ...serverRecords.map(getMastodonServerFilterFromRecord)
      ]
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
