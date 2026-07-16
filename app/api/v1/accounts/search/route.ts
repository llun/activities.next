import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getConfig } from '@/lib/config'
import { localizeAccounts } from '@/lib/services/accounts/localizeAccount'
import { refreshKnownRemoteActor } from '@/lib/services/actors/refreshRemoteActor'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { parseAccountHandle } from '@/lib/utils/accountHandle'
import { clampedLimit, clampedOffset } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const SearchParams = z.object({
  q: z.string(),
  limit: clampedLimit(80, 40),
  offset: clampedOffset(10000),
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
        limit,
        offset,
        resolve = false,
        following = false
      } = parsedParams.data

      if (!q || q.trim().length === 0) {
        return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
      }

      const query = q.trim()
      const localDomain = getConfig().host
      const accessDomain = headerHost(req.headers)
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

      // Resolve the exact handle (when requested) before running the index
      // search: a known remote actor is refreshed (stale profile + counter
      // sync) so the serialized result carries current remote data, and an
      // unknown handle is webfinger-resolved and recorded as before. This
      // route is always authenticated (OAuthGuardAnyScope).
      const handle = resolve && offset === 0 ? parseAccountHandle(query) : null
      let exactActor = handle
        ? await database.getActorFromUsername({
            username: handle.username,
            domain: handle.domain
          })
        : null
      if (handle) {
        if (exactActor) {
          exactActor = await refreshKnownRemoteActor({
            database,
            actor: exactActor
          })
        } else {
          const actorId = await getWebfingerSelf({
            account: `${handle.username}@${handle.domain}`
          })
          exactActor = actorId
            ? ((await recordActorIfNeeded({ actorId, database })) ?? null)
            : null
        }
      }

      const indexedIds = await database.searchAccountIds(
        getSearchParams(exactActor ? [exactActor.id] : [])
      )
      const results = await database.getMastodonActorsFromIds({
        ids: indexedIds
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: localizeAccounts(results, accessDomain)
      })
    }
  )
)
