import { blockActor } from '@/lib/actions/blockActor'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { resolveActorIdParam } from '@/lib/services/mastodon/resolveClientId'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_403,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'blockAccount',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:blocks']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

      const requestedActorId = await resolveActorIdParam(
        database,
        encodedAccountId
      )

      const result = await blockActor({
        database,
        currentActor,
        requestedActorId
      })
      if (result.type === 'forbidden') {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_403,
          responseStatusCode: 403
        })
      }
      if (result.type === 'not-found') {
        return apiCorsError(req, CORS_HEADERS, 404)
      }
      const { targetActorId } = result

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
