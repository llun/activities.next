import { z } from 'zod'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getConfig } from '@/lib/config'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const parseAccountHandle = (value: string) => {
  const normalized = value.trim().replace(/^@/, '')
  const [username, domain, ...rest] = normalized.split('@')
  if (!username || !domain || rest.length > 0) return null
  return { username, domain }
}

const SearchParams = z.object({
  q: z.string(),
  limit: z.coerce.number().min(1).max(80).default(40).optional(),
  offset: z.coerce.number().min(0).default(0).optional(),
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
      const exactActorIds: string[] = []

      if (query.includes('@')) {
        const handle = parseAccountHandle(query)
        if (handle) {
          let actor = await database.getActorFromUsername(handle)
          if (!actor && resolve) {
            const actorId = await getWebfingerSelf({
              account: `${handle.username}@${handle.domain}`
            })
            actor = actorId
              ? ((await recordActorIfNeeded({ actorId, database })) ?? null)
              : null
          }

          if (actor) {
            const canIncludeExact =
              !following ||
              (await database.isCurrentActorFollowing({
                currentActorId: context.currentActor.id,
                followingActorId: actor.id
              }))
            if (canIncludeExact) {
              exactActorIds.push(actor.id)
            }
          }
        }
      } else {
        const actor = await database.getActorFromUsername({
          username: query,
          domain: getConfig().host
        })
        if (actor) {
          const canIncludeExact =
            !following ||
            (await database.isCurrentActorFollowing({
              currentActorId: context.currentActor.id,
              followingActorId: actor.id
            }))
          if (canIncludeExact) {
            exactActorIds.push(actor.id)
          }
        }
      }

      const indexedIds = await database.searchAccountIds({
        q: query,
        limit,
        offset,
        exactActorIds,
        ...(following ? { followingActorId: context.currentActor.id } : {})
      })
      const results = await database.getMastodonActorsFromIds({
        ids: indexedIds
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: results
      })
    }
  )
)
