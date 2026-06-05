import { z } from 'zod'

import { encodeFavouritedByCursor } from '@/lib/database/sql/utils/favouritedByCursor'
import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { buildAccountCursorLinkHeader } from '@/lib/services/mastodon/accountCursorLinkHeader'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
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

const FavouritedByQueryParams = z.object({
  limit: z.coerce.number().int().min(1).max(80).default(40),
  max_id: z.string().min(1).optional(),
  min_id: z.string().min(1).optional(),
  since_id: z.string().min(1).optional()
})

export const GET = traceApiRoute(
  'getStatusFavouritedBy',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

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
      if (!status)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

      const favouritesPage = await database.getFavouritedBy({
        statusId,
        limit: limit + 1,
        maxId,
        minId,
        sinceId
      })
      const hasNextPage = favouritesPage.length > limit
      // The extra (limit+1)th row is the page-boundary overflow used only to
      // detect a next page. For descending pages (default/max_id/since_id) it is
      // the oldest row, at the end. For an ascending min_id page the DB reverses
      // the rows, so the overflow lands at the front and we must trim there
      // instead — otherwise the favourite immediately adjacent to the cursor is
      // dropped and a gap opens.
      const favourites = minId
        ? favouritesPage.slice(Math.max(0, favouritesPage.length - limit))
        : favouritesPage.slice(0, limit)

      const paginationLink = buildAccountCursorLinkHeader({
        req,
        limit,
        items: favourites,
        hasNextPage,
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
