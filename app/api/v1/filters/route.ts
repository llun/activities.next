import { NextRequest } from 'next/server'

import {
  parseFilterBody,
  parseV1FilterCreateInput
} from '@/lib/services/filters/parseFilterInput'
import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { getV1Filter } from '@/lib/services/mastodon/getMastodonFilter'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
  ERROR_500,
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

// Deprecated v1 filters API, served as a view over the v2 filter storage the
// same way Mastodon does: one v1 row per KEYWORD of the caller's own v2
// filters, addressed by the keyword id. Instance-wide server filters are not
// included — they are read-only and not addressable through this API.
export const GET = traceApiRoute(
  'listV1Filters',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:filters']],
    async (req, { database, currentActor }) => {
      // Mirrors Mastodon v1, which lists keywords of ALL the account's
      // filters without an expiry cutoff.
      const records = await database.getFilterRecordsForActor({
        actorId: currentActor.id
      })
      const data = records.flatMap(({ filter, keywords }) =>
        keywords.map((keyword) => getV1Filter(filter, keyword))
      )
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    }
  )
)

export const POST = traceApiRoute(
  'createV1Filter',
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
      const input = parseV1FilterCreateInput(rawBody)
      if (!input) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }

      // A v1 create is a v2 filter with exactly one keyword: the phrase
      // doubles as the filter title and the keyword text, and `irreversible`
      // maps to filter_action=hide (Mastodon's v1 controller does the same).
      const filter = await database.createFilter({
        actorId: currentActor.id,
        title: input.phrase,
        context: input.context,
        filterAction: input.irreversible ? 'hide' : 'warn',
        expiresAt: input.expiresAt,
        keywords: [{ keyword: input.phrase, wholeWord: input.wholeWord }]
      })
      const keywords = await database.getFilterKeywords({
        actorId: currentActor.id,
        filterId: filter.id
      })
      const keyword = keywords?.[0]
      if (!keyword) {
        // createFilter inserts the keyword in the same transaction, so this
        // is unreachable unless the storage is inconsistent.
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getV1Filter(filter, keyword)
      })
    }
  )
)
