import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getMastodonConversation } from '@/lib/services/mastodon/getMastodonConversation'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { ERROR_404, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'readConversation',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:conversations']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const conversation = await database.markDirectConversationRead({
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

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: await getMastodonConversation(
          database,
          conversation,
          currentActor.id
        )
      })
    }
  )
)
