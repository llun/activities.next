import { z } from 'zod'

import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
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

const FollowingQueryParams = z.object({
  max_id: z.string().optional(),
  since_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(80).default(40)
})

// GET /api/v1/accounts/:id/following — accounts the given account follows.
// https://docs.joinmastodon.org/methods/accounts/#following
//
// Public with optional auth. Paginated with Mastodon id cursors + Link headers,
// mirroring the accounts/:id/statuses route. The cursor is the underlying
// follow-row id (the column getFollowing paginates on), not the account id.
export const GET = traceApiRoute(
  'getAccountFollowing',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:follows']],
    async (req, context) => {
      const { database, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }

      const id = idToUrl(encodedAccountId)
      const actor = await database.getActorFromId({ id })
      if (!actor) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const url = new URL(req.url)
      const parsed = FollowingQueryParams.safeParse(
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
      const forwardCursor = minId ?? sinceId

      const follows = await database.getFollowing({
        actorId: id,
        limit,
        maxId,
        minId: forwardCursor
      })
      // getFollowing returns ascending order when a forward cursor is used;
      // normalize to newest-first so the Link cursors are consistent.
      const orderedFollows = forwardCursor ? [...follows].reverse() : follows

      // Batch-hydrate the followed accounts in a single query, then re-order to
      // match orderedFollows (getMastodonActorsFromIds does not guarantee order).
      const accountsById = new Map(
        (
          await database.getMastodonActorsFromIds({
            ids: orderedFollows.map((follow) => follow.targetActorId)
          })
        ).map((account) => [account.url, account])
      )
      const accounts = orderedFollows
        .map((follow) => accountsById.get(follow.targetActorId))
        .filter((account): account is NonNullable<typeof account> =>
          Boolean(account)
        )

      const host = headerHost(req.headers)
      const links: string[] = []
      if (host && orderedFollows.length > 0) {
        const pathBase = `/api/v1/accounts/${encodedAccountId}/following`
        const buildLink = (cursorName: 'max_id' | 'min_id', value: string) => {
          const linkParams = new URLSearchParams()
          linkParams.set('limit', `${limit}`)
          linkParams.set(cursorName, value)
          return `<https://${host}${pathBase}?${linkParams.toString()}>; rel="${cursorName === 'max_id' ? 'next' : 'prev'}"`
        }
        links.push(
          buildLink('max_id', orderedFollows[orderedFollows.length - 1].id)
        )
        links.push(buildLink('min_id', orderedFollows[0].id))
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: accounts,
        additionalHeaders: links.length > 0 ? [['Link', links.join(', ')]] : []
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
