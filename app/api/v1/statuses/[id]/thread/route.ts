import { z } from 'zod'

import { createWindowCounter } from '@/lib/services/gallery/lookups/rateLimit'
import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getStatusContext } from '@/lib/services/statuses/getStatusContext'
import { queueThreadGapBackfill } from '@/lib/services/statuses/parentBackfill'
import {
  THREAD_INITIAL_ANCESTORS_LIMIT,
  THREAD_INITIAL_DESCENDANTS_LIMIT,
  THREAD_MAX_ANCESTORS_LIMIT,
  THREAD_MAX_DESCENDANTS_LIMIT,
  THREAD_SIGNED_OUT_MAX_ANCESTORS_LIMIT,
  THREAD_SIGNED_OUT_MAX_DESCENDANTS_LIMIT
} from '@/lib/services/statuses/threadPageLimits'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getTrustedClientRateLimitKey } from '@/lib/utils/getTrustedClientIp'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
}

// Out-of-range limits are clamped into [1, max] (absent or non-numeric ones
// take the page's first step), as Mastodon clamps its own limits.
const ThreadQueryParams = z.object({
  ancestors_limit: clampedLimit(
    THREAD_MAX_ANCESTORS_LIMIT,
    THREAD_INITIAL_ANCESTORS_LIMIT
  ),
  descendants_limit: clampedLimit(
    THREAD_MAX_DESCENDANTS_LIMIT,
    THREAD_INITIAL_DESCENDANTS_LIMIT
  )
})

const WINDOW_MS = 60_000
// Each request is bounded by the capped limits and the loader's visit budget;
// these bound how many a client can make. Signed out, a request is keyed by
// the trusted client address when there is one, and every signed-out request
// also counts against one shared window. Without trusted proxy client-address
// headers that shared window is the only one, so every signed-out reader
// shares one pool; their limits are capped lower (the middle step) for that.
const PER_VIEWER_LIMIT = 30
const ANONYMOUS_GLOBAL_LIMIT = 300
// Signed-in readers and signed-out addresses get separate maps, so a flood of
// fresh addresses can only push other addresses out, never a reader's count.
const actorCounter = createWindowCounter({
  limit: PER_VIEWER_LIMIT,
  windowMs: WINDOW_MS,
  maxKeys: 10_000
})
const ipCounter = createWindowCounter({
  limit: PER_VIEWER_LIMIT,
  windowMs: WINDOW_MS,
  maxKeys: 10_000
})
const anonymousCounter = createWindowCounter({
  limit: ANONYMOUS_GLOBAL_LIMIT,
  windowMs: WINDOW_MS,
  maxKeys: 1
})

/** Clears the request windows (tests only). */
export const resetThreadRateLimitsForTesting = () => {
  actorCounter.reset()
  ipCounter.reset()
  anonymousCounter.reset()
}

/**
 * The web client's thread context: the post page and the fitness activity
 * page ask for it when the reader loads earlier posts or more replies. Not a
 * Mastodon endpoint (`GET /api/v1/statuses/:id/context` is), so it has no CORS
 * preflight. It answers the same domain statuses the page renders, serialized
 * the same way (`cleanJson`), with the same viewer rules: `getStatusContext`
 * with the viewer, so signed out it is public statuses only.
 */
export const GET = traceApiRoute(
  'getStatusThread',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

      // Signed out, keyed by the trusted address with IPv6 collapsed to its
      // /64, so rotating interface ids does not mint new keys.
      const ipKey = currentActor ? undefined : getTrustedClientRateLimitKey(req)
      const withinViewerLimit = currentActor
        ? actorCounter.tryHit(currentActor.id)
        : ipKey === undefined || ipCounter.tryHit(ipKey)
      if (!withinViewerLimit) {
        return apiErrorResponse(HTTP_STATUS.TOO_MANY_REQUESTS)
      }
      if (!currentActor && !anonymousCounter.tryHit('anonymous')) {
        return apiErrorResponse(HTTP_STATUS.TOO_MANY_REQUESTS)
      }

      const parsed = ThreadQueryParams.safeParse(
        Object.fromEntries(new URL(req.url).searchParams)
      )
      if (!parsed.success) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

      const {
        status,
        ancestors,
        descendants,
        hasMoreAncestors,
        hasMoreDescendants,
        missingParentId
      } = await getStatusContext({
        database,
        statusId: encodedStatusId,
        currentActor,
        ancestorsLimit: currentActor
          ? parsed.data.ancestors_limit
          : Math.min(
              parsed.data.ancestors_limit,
              THREAD_SIGNED_OUT_MAX_ANCESTORS_LIMIT
            ),
        descendantsLimit: currentActor
          ? parsed.data.descendants_limit
          : Math.min(
              parsed.data.descendants_limit,
              THREAD_SIGNED_OUT_MAX_DESCENDANTS_LIMIT
            )
      })
      if (!status) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

      // As the context route and the page do: a signed-in read whose ancestor
      // walk stops at a parent this instance does not have queues its fetch.
      // "Load earlier posts" can reach a gap the page's first step did not.
      if (currentActor) {
        await queueThreadGapBackfill({ database, missingParentId })
      }

      return apiResponse({
        req,
        allowedMethods: [HttpMethod.enum.GET],
        data: {
          ancestors: ancestors.map((item) => cleanJson(item)),
          descendants: descendants.map((item) => cleanJson(item)),
          hasMoreAncestors,
          hasMoreDescendants
        }
      })
    },
    { matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
