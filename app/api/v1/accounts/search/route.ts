import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getConfig } from '@/lib/config'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { parseAccountHandle } from '@/lib/utils/accountHandle'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const SearchParams = z.object({
  q: z.string(),
  limit: z.coerce.number().int().min(1).max(80).default(40).optional(),
  offset: z.coerce.number().int().min(0).max(10000).default(0).optional(),
  resolve: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  following: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
})

export const GET = traceApiRoute(
  'searchAccounts',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:accounts'], Scope.enum['read:search']],
    async (req, context) => {
      const { database } = context

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

      const {
        q,
        limit = 40,
        offset = 0,
        resolve = false,
        following = false
      } = parsedParams.data

      if (!q || q.trim().length === 0) {
        return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
      }

      const query = q.trim()
      const localDomain = getConfig().host
      const getSearchParams = (exactActorIds: string[] = []) => {
        return {
          q: query,
          limit,
          offset,
          localDomain,
          exactActorIds,
          ...(following ? { followingActorId: context.currentActor.id } : {})
        }
      }

      let indexedIds = await database.searchAccountIds(getSearchParams())
      let results = await database.getMastodonActorsFromIds({
        ids: indexedIds
      })

      const handle = resolve && offset === 0 ? parseAccountHandle(query) : null
      const exactAcct = handle
        ? `${handle.username}@${handle.domain}`.toLowerCase()
        : null
      const hasExactHandle = exactAcct
        ? results.some((actor) => actor.acct.toLowerCase() === exactAcct)
        : false

      if (handle && !hasExactHandle) {
        const actorId = await getWebfingerSelf({
          account: `${handle.username}@${handle.domain}`
        })
        const actor = actorId
          ? ((await recordActorIfNeeded({ actorId, database })) ?? null)
          : null
        if (actor) {
          indexedIds = await database.searchAccountIds(
            getSearchParams([actor.id])
          )
          results = await database.getMastodonActorsFromIds({
            ids: indexedIds
          })
        }
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: results
      })
    }
  )
)
