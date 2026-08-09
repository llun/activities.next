import { z } from 'zod'

import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { buildAccountCursorLinkHeader } from '@/lib/services/mastodon/accountCursorLinkHeader'
import { resolveStatusIdParam } from '@/lib/services/mastodon/resolveClientId'
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
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const RebloggedByQueryParams = z.object({
  limit: clampedLimit(80, 40),
  max_id: z.string().min(1).optional(),
  min_id: z.string().min(1).optional(),
  since_id: z.string().min(1).optional()
})

export const GET = traceApiRoute(
  'getStatusRebloggedBy',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      const queryParams = Object.fromEntries(new URL(req.url).searchParams)
      const parsedParams = RebloggedByQueryParams.safeParse(queryParams)
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
      const statusId = await resolveStatusIdParam(database, encodedStatusId)
      const status = await getReadableStatus({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)

      const resolvedMaxId = maxId
        ? await resolveStatusIdParam(database, maxId)
        : undefined
      const resolvedMinId = minId
        ? await resolveStatusIdParam(database, minId)
        : undefined
      const resolvedSinceId = sinceId
        ? await resolveStatusIdParam(database, sinceId)
        : undefined

      const reblogsPage = await database.getRebloggedBy({
        statusId,
        limit: limit + 1,
        maxStatusId: resolvedMaxId,
        minStatusId: resolvedMinId,
        sinceStatusId: resolvedSinceId,
        visibleToActorId: currentActor?.id ?? null
      })
      const hasOverflow = reblogsPage.length > limit
      // The extra (limit+1)th row is the page-boundary overflow used only to
      // detect another page. For descending pages (default/max_id/since_id) it
      // is the oldest row, at the end, so it signals more OLDER results (the
      // next/max_id link). For an ascending min_id page the DB reverses the
      // rows, so the overflow lands at the front and signals more NEWER results
      // (the prev/since_id link); we also trim from the front there so the
      // reblog immediately adjacent to the cursor is not dropped.
      const reblogs = minId
        ? reblogsPage.slice(Math.max(0, reblogsPage.length - limit))
        : reblogsPage.slice(0, limit)

      // Newest-first page: next (older/max_id) and prev (newer/since_id) are
      // gated independently. A min_id page paged forward toward newer results,
      // so its overflow indicates more on the prev (newer) side; older results
      // (the cursor and below) always exist, so next is always offered. Other
      // pages move older, so overflow indicates more on the next (older) side
      // and newer results always exist behind them.
      const hasNext = minId ? true : hasOverflow
      const hasPrev = minId ? hasOverflow : true

      // Reblog rows carry only the announce URI, so resolve the page's public
      // ids in one batched query instead of one lookup per cursor. A row with no
      // publicId falls back to the legacy colon form, which the accept side
      // still resolves.
      const reblogPublicIds = await database.getStatusPublicIds({
        statusIds: reblogs.map((reblog) => reblog.statusId)
      })
      const paginationLink = buildAccountCursorLinkHeader({
        req,
        limit,
        items: reblogs,
        hasNext,
        hasPrev,
        toCursor: (reblog) =>
          reblogPublicIds.get(reblog.statusId) ?? urlToId(reblog.statusId)
      })

      const requestedActorIds = reblogs.map(({ actorId }) => actorId)
      const requestedActorIdSet = new Set(requestedActorIds)
      const accounts = await database.getMastodonActorsFromIds({
        ids: requestedActorIds
      })
      // Preserve the reblog order: getMastodonActorsFromIds does not guarantee
      // it, and Mastodon returns accounts newest-reblog-first.
      // `uri` is the ActivityPub actor id — the value the lookup was made with —
      // so it is the only encoding-independent key. `url` is a profile URL
      // (`/@name`) on some actors and `id` is a publicId that cannot be decoded
      // back to a URI, so both are only fallbacks.
      const accountById = new Map<string, (typeof accounts)[number]>()
      for (const account of accounts) {
        const actorId = [
          account.uri,
          account.url,
          typeof account.id === 'string' ? idToUrl(account.id) : ''
        ].find((candidate) => requestedActorIdSet.has(candidate))
        if (actorId) accountById.set(actorId, account)
      }
      const orderedAccounts = reblogs
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
    // reblogged_by_accounts scope), consistent with favourited_by.
    { matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
