import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { resolveConversationRootId } from '@/lib/services/mastodon/conversationMute'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_500,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const POST = traceApiRoute(
  'muteStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.write, Scope.enum['write:mutes']],
    async (req, context) => {
      const { database, currentActor, params } = context
      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      const statusId = idToUrl(encodedStatusId)
      const status = await getReadableStatus({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)

      // Mute the whole conversation (thread), keyed on its root, matching
      // Mastodon's per-conversation mute semantics.
      const conversationRootId = await resolveConversationRootId(
        database,
        status
      )
      await database.createStatusMute({
        actorId: currentActor.id,
        statusId: conversationRootId
      })

      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        currentActor.id
      )
      if (!mastodonStatus)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatus
      })
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
