import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import {
  parseFilterBody,
  parseV1FilterUpdateInput
} from '@/lib/services/filters/parseFilterInput'
import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { getV1Filter } from '@/lib/services/mastodon/getMastodonFilter'
import { Scope } from '@/lib/types/database/operations'
import { FilterAction } from '@/lib/types/domain/filter'
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

// The deprecated v1 API addresses individual KEYWORDS of v2 filters: `id`
// here is a filter keyword id, not a filter id (matching Mastodon's v1 shim
// over its v2 storage). getFilterKeyword is ownership-checked, so foreign
// keyword ids resolve to null and 404.
const getOwnedKeywordWithFilter = async (
  database: Database,
  actorId: string,
  keywordId: string
) => {
  const keyword = await database.getFilterKeyword({ actorId, id: keywordId })
  if (!keyword) return null
  const filter = await database.getFilter({ actorId, id: keyword.filterId })
  if (!filter) return null
  return { keyword, filter }
}

const contextsDiffer = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return true
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.some((value, index) => value !== sortedB[index])
}

export const GET = traceApiRoute(
  'getV1Filter',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:filters']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const row = await getOwnedKeywordWithFilter(database, currentActor.id, id)
      if (!row)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getV1Filter(row.filter, row.keyword)
      })
    }
  )
)

export const PUT = traceApiRoute(
  'updateV1Filter',
  OAuthGuard<Params>(
    [Scope.enum['write:filters']],
    async (req: NextRequest, { database, currentActor, params }) => {
      const { id } = await params
      const row = await getOwnedKeywordWithFilter(database, currentActor.id, id)
      if (!row)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })

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
      const input = parseV1FilterUpdateInput(rawBody)
      if (!input)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })

      const { filter } = row
      const filterAction: FilterAction | undefined =
        input.irreversible === undefined
          ? undefined
          : input.irreversible
            ? 'hide'
            : 'warn'

      // Mirror Mastodon's v1 guard: parent-filter attributes (title/phrase,
      // context, irreversible, expires_in) may only change while the filter
      // has a single keyword — otherwise a v1 client would silently rewrite
      // a v2 filter shared by its sibling keywords. The check runs before
      // any write so a rejected request changes nothing.
      const parentWouldChange =
        input.phrase !== filter.title ||
        contextsDiffer(input.context, filter.context) ||
        (filterAction !== undefined && filterAction !== filter.filterAction) ||
        (input.expiresAt !== undefined && input.expiresAt !== filter.expiresAt)
      const siblings = await database.getFilterKeywords({
        actorId: currentActor.id,
        filterId: filter.id
      })
      if (parentWouldChange && (siblings?.length ?? 0) > 1)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })

      const updatedKeyword = await database.updateFilterKeyword({
        actorId: currentActor.id,
        id,
        keyword: input.phrase,
        wholeWord: input.wholeWord
      })
      if (updatedKeyword === null)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      if (updatedKeyword === 'duplicate')
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })

      // Sequential second write: the DB layer has no cross-entity
      // transaction API, so the keyword rename above and this parent update
      // are not atomic. Acceptable for the deprecated shim — a crash in
      // between leaves a renamed keyword with unchanged parent settings.
      const updatedFilter = await database.updateFilter({
        actorId: currentActor.id,
        id: filter.id,
        title: input.phrase,
        context: input.context,
        filterAction,
        expiresAt: input.expiresAt
      })
      if (!updatedFilter)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getV1Filter(updatedFilter, updatedKeyword)
      })
    }
  )
)

// Rails `resources` maps update to both PATCH and PUT; Mastodon clients
// commonly send PATCH. Bind PATCH to the same handler so it does not 405.
export const PATCH = PUT

export const DELETE = traceApiRoute(
  'deleteV1Filter',
  OAuthGuard<Params>(
    [Scope.enum['write:filters']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const row = await getOwnedKeywordWithFilter(database, currentActor.id, id)
      if (!row)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })

      const siblings = await database.getFilterKeywords({
        actorId: currentActor.id,
        filterId: row.filter.id
      })
      // Mastodon's v1 destroy removes the keyword and then the parent
      // filter when no keywords remain. deleteFilter cascades keywords and
      // statuses inside one transaction, so the last-keyword case is a
      // single atomic call rather than keyword-then-filter.
      if ((siblings?.length ?? 0) <= 1) {
        await database.deleteFilter({
          actorId: currentActor.id,
          id: row.filter.id
        })
      } else {
        await database.deleteFilterKeyword({ actorId: currentActor.id, id })
      }
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
