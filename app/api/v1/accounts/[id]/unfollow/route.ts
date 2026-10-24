import { unfollowActor } from '@/lib/actions/unfollowActor'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'unfollowAccount',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:follows']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

      const targetActorId = await resolveActorIdParam(
        database,
        encodedAccountId
      )

      const unfollowed = await unfollowActor({
        database,
        currentActor,
        targetActorId
      })
      if (!unfollowed) return apiCorsError(req, CORS_HEADERS, 404)

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
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
