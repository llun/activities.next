import { NextRequest } from 'next/server'
import { z } from 'zod'

import { search } from '@/lib/search'
import {
  OptionalOAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_400,
  ERROR_401,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import {
  BooleanSearchParam,
  urlSearchParamsToObject
} from '@/lib/utils/searchParams'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const SearchParams = z.object({
  q: z.string().max(500).default(''),
  type: z.enum(['accounts', 'statuses', 'hashtags']).optional(),
  limit: z.coerce.number().int().min(1).max(40).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  min_id: z.string().min(1).optional(),
  max_id: z.string().min(1).optional(),
  account_id: z.string().min(1).optional(),
  following: BooleanSearchParam,
  resolve: BooleanSearchParam,
  exclude_unreviewed: BooleanSearchParam
})

const decodeSearchId = (id?: string) => (id ? idToUrl(id) || id : undefined)

export const GET = traceApiRoute(
  'search',
  OptionalOAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:search']],
    async (req: NextRequest, { currentActor, database }) => {
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

      const {
        q,
        type,
        limit,
        offset,
        min_id,
        max_id,
        account_id,
        following,
        resolve,
        exclude_unreviewed
      } = parsedParams.data
      const query = q.trim()
      const usesTypedOffset = Boolean(type) && offset > 0

      if (
        !currentActor &&
        (following || resolve || usesTypedOffset || type === 'statuses')
      ) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_401,
          responseStatusCode: 401
        })
      }

      if (!query) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            accounts: [],
            statuses: [],
            hashtags: []
          }
        })
      }

      const includeAccounts = type ? type === 'accounts' : true
      const includeStatuses = type ? type === 'statuses' : Boolean(currentActor)
      const includeHashtags = type ? type === 'hashtags' : true
      const effectiveOffset = type ? offset : 0

      const results = await search({
        database,
        query,
        limit,
        offset: effectiveOffset,
        currentActorId: currentActor?.id,
        includeAccounts,
        includeStatuses,
        includeHashtags,
        accountId: decodeSearchId(account_id),
        maxStatusId: decodeSearchId(max_id),
        minStatusId: decodeSearchId(min_id),
        following,
        resolve,
        excludeUnreviewed: exclude_unreviewed
      })
      const statuses = (
        await Promise.all(
          results.statuses.map((status) =>
            getMastodonStatus(database, status, currentActor?.id)
          )
        )
      ).filter((status) => status !== null)

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          accounts: results.accounts,
          statuses,
          hashtags: results.hashtags
        }
      })
    },
    {
      errorResponse: corsErrorResponse(CORS_HEADERS)
    }
  )
)
