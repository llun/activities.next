import { getRelationship } from '@/lib/services/accounts/relationship'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { resolveActorIdParams } from '@/lib/services/mastodon/resolveClientId'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

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
      // Preserve request order and accept both `id[]` and bare `id`.
      const accountIds = [
        ...url.searchParams.getAll('id[]'),
        ...url.searchParams.getAll('id')
      ].filter(Boolean)

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
            if (!targetActorId) return null
            return getRelationship({
              database,
              currentActor,
              targetActorId
            })
          } catch (error) {
            logger.error(
              { error, accountId: encodedAccountId },
              `Error processing relationship for ID ${encodedAccountId}`
            )
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
