import { recordActorIfNeeded } from '@/lib/actions/utils'
import { localizeAccount } from '@/lib/services/accounts/localizeAccount'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// GET /api/v1/accounts/:id — view a single account.
// https://docs.joinmastodon.org/methods/accounts/#get
//
// Mastodon serves this publicly (auth is optional). We use OptionalOAuthGuard so
// a valid token is accepted but never required; the returned Account is the same
// already-public actor profile exposed over ActivityPub/WebFinger.
export const GET = traceApiRoute(
  'getAccount',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)
      const id = idToUrl(encodedAccountId)

      // Opening a profile is the moment a client needs current remote data
      // (display name, bio, lock state, follower/following/status counts), so
      // refresh known remote actors here. recordActorIfNeeded is a no-op for
      // recently-synced actors, only refreshing stale ones, and any failure
      // falls back to the stored profile. Gated on an authenticated viewer and
      // an already-known actor so anonymous requests never trigger remote
      // fetches for arbitrary ids.
      if (currentActor) {
        const [persistedActor, isInternalActor] = await Promise.all([
          database.getActorFromId({ id }),
          database.isInternalActor({ actorId: id })
        ])
        if (persistedActor && !isInternalActor) {
          await recordActorIfNeeded({ actorId: id, database }).catch(
            (error) => {
              logger.warn({
                message: 'Failed to refresh remote actor for account view',
                actorId: id,
                error: error instanceof Error ? error.message : String(error)
              })
            }
          )
        }
      }

      const actor = await database.getMastodonActorFromId({ id })
      if (!actor) return apiCorsError(req, CORS_HEADERS, 404)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: localizeAccount(actor, headerHost(req.headers))
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
