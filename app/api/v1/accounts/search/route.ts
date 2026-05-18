import { z } from 'zod'

import { resolveAccountForSearch } from '@/lib/search/resolveAccount'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import {
  BooleanSearchParam,
  urlSearchParamsToObject
} from '@/lib/utils/searchParams'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const SearchParams = z.object({
  q: z.string().max(500),
  limit: z.coerce.number().int().min(1).max(80).default(40),
  offset: z.coerce.number().int().min(0).default(0),
  resolve: BooleanSearchParam,
  following: BooleanSearchParam
})

const normalizeAccountSearchQuery = (query: string) =>
  query
    .trim()
    .replace(/^acct:/i, '')
    .replace(/^@/, '')

export const GET = traceApiRoute(
  'searchAccounts',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:search']],
    async (req, context) => {
      const { currentActor, database } = context

      const url = new URL(req.url)
      const queryParams = urlSearchParamsToObject(url.searchParams)

      const parsedParams = SearchParams.safeParse(queryParams)
      if (!parsedParams.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const { q, limit, offset, following, resolve } = parsedParams.data
      if (!q || q.trim().length === 0) {
        return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
      }

      const query = normalizeAccountSearchQuery(q)
      if (!query) {
        return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
      }

      if (resolve) {
        await resolveAccountForSearch({ database, query })
      }

      const results = await database.searchAccounts({
        query,
        limit,
        offset,
        currentActorId: currentActor.id,
        following,
        resolve
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: results
      })
    }
  )
)
