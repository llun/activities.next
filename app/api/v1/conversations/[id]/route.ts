import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.DELETE]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const DELETE = traceApiRoute(
  'deleteConversation',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:conversations']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const conversation = await database.getDirectConversation({
        actorId: currentActor.id,
        conversationId: id
      })
      if (!conversation) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      await database.hideDirectConversation({
        actorId: currentActor.id,
        conversationId: id
      })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {}
      })
    }
  )
)
