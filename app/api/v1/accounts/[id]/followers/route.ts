import { z } from 'zod'

import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
import { buildPaginationLinkHeader } from '@/lib/utils/paginationLinkHeader'
import {
  ERROR_400,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const FollowersQueryParams = z.object({
  max_id: z.string().optional(),
  since_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: clampedLimit(80, 40)
})

// GET /api/v1/accounts/:id/followers — accounts which follow the given account.
// https://docs.joinmastodon.org/methods/accounts/#followers
//
// Public with optional auth. Paginated with Mastodon id cursors + Link headers,
// mirroring the accounts/:id/statuses route. The cursor is the underlying
// follow-row id (the column getFollowers paginates on), not the account id.
export const GET = traceApiRoute(
  'getAccountFollowers',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:follows']],
    async (req, context) => {
      const { database, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

      const id = idToUrl(encodedAccountId)
      const actor = await database.getActorFromId({ id })
      if (!actor) return apiCorsError(req, CORS_HEADERS, 404)

      const url = new URL(req.url)
      const parsed = FollowersQueryParams.safeParse(
        Object.fromEntries(url.searchParams.entries())
      )
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }
      const {
        limit,
        max_id: maxId,
        min_id: minId,
        since_id: sinceId
      } = parsed.data

      // getFollowers applies the correct ordering per cursor and always returns
      // newest-first; the cursor is the follow-row id.
      const orderedFollows = await database.getFollowers({
        targetActorId: id,
        limit,
        maxId,
        minId,
        sinceId
      })

      // Batch-hydrate the follower accounts in a single query, then re-order to
      // match orderedFollows (getMastodonActorsFromIds does not guarantee order).
      const accountsById = new Map(
        (
          await database.getMastodonActorsFromIds({
            ids: orderedFollows.map((follow) => follow.actorId)
          })
        ).map((account) => [account.url, account])
      )
      const accounts = orderedFollows
        .map((follow) => accountsById.get(follow.actorId))
        .filter((account): account is NonNullable<typeof account> =>
          Boolean(account)
        )

      const additionalHeaders = buildPaginationLinkHeader({
        host: headerHost(req.headers),
        path: `/api/v1/accounts/${encodedAccountId}/followers`,
        limit,
        nextMaxId:
          orderedFollows.length > 0
            ? orderedFollows[orderedFollows.length - 1].id
            : null,
        prevMinId: orderedFollows.length > 0 ? orderedFollows[0].id : null
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: accounts,
        additionalHeaders
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS), matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
