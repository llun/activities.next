import { getRelationship } from '@/lib/services/accounts/relationship'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import {
  isResolvedActorUri,
  resolveActorIdParams
} from '@/lib/services/mastodon/resolveClientId'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

// Upper bound on how many accounts a single relationships request may ask
// about. Mastodon does not document a cap; dedupe + truncate the way
// `GET /api/v1/accounts` does rather than letting a header-sized id list drive
// the per-request work. Exported so the route test can exercise truncation.
export const MAX_BATCH_RELATIONSHIPS = 100

export const OPTIONS = defaultOptions(CORS_HEADERS)

// GET /api/v1/accounts/relationships — check relationships to other accounts.
// https://docs.joinmastodon.org/methods/accounts/#relationships
// Scope: read:follows (satisfied by aggregate `read`). Accepts both the
// array-style `id[]` and the bare repeated `id` param. `with_suspended` is
// accepted for compatibility; this service does not track suspension, so every
// resolvable account is treated as not suspended.
export const GET = traceApiRoute(
  'getAccountRelationships',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:follows']],
    async (req, context) => {
      const { database, currentActor } = context

      const url = new URL(req.url)
      // Deduplicate and bound the requested ids, then preserve request order.
      // Accept both `id[]` and bare `id`.
      const accountIds = Array.from(
        new Set(
          [
            ...url.searchParams.getAll('id[]'),
            ...url.searchParams.getAll('id')
          ].filter(Boolean)
        )
      ).slice(0, MAX_BATCH_RELATIONSHIPS)

      if (!accountIds.length) {
        return apiResponse({ req, allowedMethods: CORS_HEADERS, data: [] })
      }

      // One batched publicId lookup for the whole list, not one per id. The
      // result is index-aligned with accountIds.
      const resolvedIds = await resolveActorIdParams(database, accountIds)

      // Resolve in the requested order; drop ids that don't resolve.
      const relationships = await Promise.all(
        accountIds.map(async (encodedAccountId, index) => {
          try {
            const targetActorId = resolvedIds[index]
            // Keep the falsy guard AND filter to actual URIs: `idToUrl` returns
            // '' for a bad `apurl_` (so the falsy guard is live), and returns an
            // unknown publicId or an unparseable value unchanged — neither is an
            // actor URI, and `getRelationship` would then key a lookup on a
            // non-id. The filter runs on the resolver OUTPUT only; it prunes no
            // input form the resolver accepts.
            if (!targetActorId || !isResolvedActorUri(targetActorId))
              return null
            // Awaited inside the try so a rejection is caught HERE and drops
            // this one id. Returning the un-awaited promise adopted it after
            // the try exited, leaving the catch dead — one failing id then
            // rejected the whole `Promise.all` and failed the request.
            return await getRelationship({
              database,
              currentActor,
              targetActorId
            })
          } catch (error) {
            logger.error({
              message: 'Error processing relationship for account id',
              accountId: encodedAccountId,
              err: toLoggableError(error)
            })
            return null
          }
        })
      )

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: relationships.filter(Boolean)
      })
    },
    { errorResponse: corsErrorResponse(CORS_HEADERS) }
  )
)
