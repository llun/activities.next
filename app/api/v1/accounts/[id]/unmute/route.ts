import { applyUnmute } from '@/lib/actions/applyUnmute'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'unmuteAccount',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:mutes']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedAccountId = (await params).id
      if (!encodedAccountId) return apiCorsError(req, CORS_HEADERS, 400)

      const targetActorId = idToUrl(encodedAccountId)

      if (targetActorId !== currentActor.id) {
        // deleteMute uses a raw lookup (no expiry filter) so expired rows are
        // cleaned up too. If nothing was deleted, validate the actor exists.
        const deleted = await applyUnmute({
          database,
          actorId: currentActor.id,
          targetActorId
        })

        if (!deleted) {
          const targetActor = await database.getActorFromId({
            id: targetActorId
          })
          if (!targetActor) return apiCorsError(req, CORS_HEADERS, 404)
        }
      }

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
