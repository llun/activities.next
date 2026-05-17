import { z } from 'zod'

import { resolveAccountForSearch } from '@/lib/search/resolveAccount'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const BooleanString = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true')

const SearchParams = z.object({
  q: z.string(),
  limit: z.coerce.number().int().min(1).max(80).default(40),
  offset: z.coerce.number().int().min(0).default(0),
  resolve: BooleanString,
  following: BooleanString
})

export const GET = traceApiRoute(
  'searchAccounts',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:search']],
    async (req, context) => {
      const { currentActor, database } = context

      const url = new URL(req.url)
      const queryParams: Record<string, string> = {}
      url.searchParams.forEach((value, key) => {
        queryParams[key] = value
      })

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

      const query = q.trim()
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
