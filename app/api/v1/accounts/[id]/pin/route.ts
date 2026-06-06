import { getRelationship } from '@/lib/services/accounts/relationship'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// POST /api/v1/accounts/:id/pin — feature (endorse) an account on your profile.
// https://docs.joinmastodon.org/methods/accounts/#pin
// Mastodon only allows featuring accounts you follow.
export const POST = traceApiRoute(
  'pinAccount',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:accounts']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

      const targetActorId = idToUrl(encodedAccountId)
      const target = await database.getActorFromId({ id: targetActorId })
      if (!target) return apiCorsError(req, CORS_HEADERS, 404)

      const isFollowing = await database.isCurrentActorFollowing({
        currentActorId: currentActor.id,
        followingActorId: targetActorId
      })
      if (!isFollowing) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'You must be following the account to feature it.' },
          responseStatusCode: 422
        })
      }

      await database.createEndorsement({
        actorId: currentActor.id,
        targetActorId
      })

      const relationship = await getRelationship({
        database,
        currentActor,
        targetActorId
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: relationship
      })
    },
    guardOptions
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
