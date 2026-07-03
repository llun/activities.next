import { z } from 'zod'

import { encodeFavouritedByCursor } from '@/lib/database/sql/utils/favouritedByCursor'
import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { buildAccountCursorLinkHeader } from '@/lib/services/mastodon/accountCursorLinkHeader'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { HttpMethod } from '@/lib/utils/http-headers'
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

const FavouritedByQueryParams = z.object({
  limit: clampedLimit(80, 40),
  max_id: z.string().min(1).optional(),
  min_id: z.string().min(1).optional(),
  since_id: z.string().min(1).optional()
})

export const GET = traceApiRoute(
  'getStatusFavouritedBy',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:accounts'], Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      const queryParams = Object.fromEntries(new URL(req.url).searchParams)
      const parsedParams = FavouritedByQueryParams.safeParse(queryParams)
      if (!parsedParams.success) {
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
      } = parsedParams.data
      const statusId = idToUrl(encodedStatusId)
      const status = await getReadableStatus({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)

      const favouritesPage = await database.getFavouritedBy({
        statusId,
        limit: limit + 1,
        maxId,
        minId,
        sinceId
      })
      const hasOverflow = favouritesPage.length > limit
      // The extra (limit+1)th row is the page-boundary overflow used only to
      // detect another page. For descending pages (default/max_id/since_id) it
      // is the oldest row, at the end, so it signals more OLDER results (the
      // next/max_id link). For an ascending min_id page the DB reverses the
      // rows, so the overflow lands at the front and signals more NEWER results
      // (the prev/since_id link); we also trim from the front there so the
      // favourite immediately adjacent to the cursor is not dropped.
      const favourites = minId
        ? favouritesPage.slice(Math.max(0, favouritesPage.length - limit))
        : favouritesPage.slice(0, limit)

      // Newest-first page: next (older/max_id) and prev (newer/since_id) are
      // gated independently. A min_id page paged forward toward newer results,
      // so its overflow indicates more on the prev (newer) side; older results
      // (the cursor and below) always exist, so next is always offered. Other
      // pages move older, so overflow indicates more on the next (older) side
      // and newer results always exist behind them.
      const hasNext = minId ? true : hasOverflow
      const hasPrev = minId ? hasOverflow : true

      const paginationLink = buildAccountCursorLinkHeader({
        req,
        limit,
        items: favourites,
        hasNext,
        hasPrev,
        toCursor: (favourite) =>
          encodeFavouritedByCursor({
            createdAt: favourite.createdAt,
            actorId: favourite.actorId
          })
      })

      const accounts = await database.getMastodonActorsFromIds({
        ids: favourites.map(({ actorId }) => actorId)
      })
      // Preserve the favourite order: getMastodonActorsFromIds does not guarantee
      // it, and Mastodon returns accounts newest-favourite-first.
      const accountById = new Map<string, (typeof accounts)[number]>()
      for (const account of accounts) {
        if (typeof account.id === 'string')
          accountById.set(idToUrl(account.id), account)
        if (account.url) accountById.set(account.url, account)
      }
      const orderedAccounts = favourites
        .map(({ actorId }) => accountById.get(actorId))
        .filter((account): account is NonNullable<typeof account> =>
          Boolean(account)
        )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: orderedAccounts,
        additionalHeaders: paginationLink ? [['Link', paginationLink]] : []
      })
    },
    // read or read:accounts satisfies the requirement (Mastodon's
    // favourited_by_accounts scope).
    { matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
