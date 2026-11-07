import { z } from 'zod'

import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { localizeAccounts } from '@/lib/services/accounts/localizeAccount'
import {
  recordRemoteActorBestEffort,
  refreshKnownRemoteActor
} from '@/lib/services/actors/refreshRemoteActor'
import { isLocalDomain } from '@/lib/services/domains/localDomains'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import {
  BLUESKY_BRIDGE_DOMAIN,
  parseAccountHandle,
  parseAccountUrlHandle,
  parseBlueskyBridgeQuery
} from '@/lib/utils/accountHandle'
import { clampedLimit, clampedOffset } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { MAX_SEARCH_QUERY_LENGTH } from '@/lib/utils/searchQueryLimits'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const SearchParams = z.object({
  q: z.string().max(MAX_SEARCH_QUERY_LENGTH),
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
      const accessDomain = headerHost(req.headers)
      const getSearchParams = (exactActorIds: string[] = []) => {
        return {
          q: query,
          limit,
          offset,
          localDomain: accessDomain,
          exactActorIds,
          ...(following ? { followingActorId: context.currentActor.id } : {})
        }
      }

      // Resolve the exact handle (when requested) before running the index
      // search: a known remote actor is refreshed (stale profile + counter
      // sync) so the serialized result carries current remote data, and an
      // unknown handle is webfinger-resolved and recorded best-effort (a
      // downed or federation-blocked remote degrades to the indexed results
      // instead of failing the search). The known actor's id is already in
      // hand, so its refresh only has to finish before serialization and runs
      // alongside the index search. This route is always authenticated
      // (OAuthGuardAnyScope).
      const firstResolvePage = resolve && offset === 0
      const directActor =
        firstResolvePage && /^https?:\/\//i.test(query)
          ? await database.getActorFromId({ id: query })
          : null
      const directHandle =
        firstResolvePage && !directActor
          ? (parseAccountHandle(query) ?? parseAccountUrlHandle(query))
          : null
      // A Bluesky handle or bsky.app profile link resolves to its Bridgy Fed
      // actor, unless the instance does not federate with the bridge. As on
      // /api/v2/search, a bare handle is first tried as a local username, and
      // a local account found that way is the exact match instead.
      const bridgeQuery =
        firstResolvePage && !directActor && !directHandle
          ? parseBlueskyBridgeQuery(query)
          : null
      const localNamesake =
        bridgeQuery && !/^https?:\/\//i.test(query)
          ? await database.getActorFromUsername({
              username: query.replace(/^@/, ''),
              domain: accessDomain
            })
          : null
      const bridgedQuery =
        bridgeQuery &&
        !localNamesake &&
        (await canFederateWithDomain(database, BLUESKY_BRIDGE_DOMAIN))
          ? bridgeQuery
          : null
      const bridgedActorId =
        bridgedQuery && /^https:\/\//.test(bridgedQuery) ? bridgedQuery : null
      const handle =
        directHandle ??
        (bridgedQuery && !bridgedActorId
          ? parseAccountHandle(bridgedQuery)
          : null)
      const storedExactActor =
        directActor ??
        localNamesake ??
        (bridgedActorId
          ? await database.getActorFromId({ id: bridgedActorId })
          : null) ??
        (handle
          ? await database.getActorFromUsername({
              username: handle.username,
              domain: handle.domain
            })
          : null)
      let exactActorId = storedExactActor?.id ?? null
      let exactActorRefresh: Promise<unknown> = Promise.resolve()
      if (handle || bridgedActorId) {
        if (storedExactActor) {
          exactActorRefresh = refreshKnownRemoteActor({
            database,
            actor: storedExactActor
          })
        } else if (bridgedActorId) {
          const recordedActor = await recordRemoteActorBestEffort({
            actorId: bridgedActorId,
            database
          })
          exactActorId = recordedActor?.id ?? null
        } else if (handle && !(await isLocalDomain(database, handle.domain))) {
          const actorId = await getWebfingerSelf({
            account: `${handle.username}@${handle.domain}`
          })
          const recordedActor = actorId
            ? await recordRemoteActorBestEffort({ actorId, database })
            : null
          exactActorId = recordedActor?.id ?? null
        }
      }

      const [indexedIds] = await Promise.all([
        database.searchAccountIds(
          getSearchParams(exactActorId ? [exactActorId] : [])
        ),
        exactActorRefresh
      ])
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
