import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatusEdits } from '@/lib/services/mastodon/getMastodonStatusEdits'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { Scope } from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getStatusHistory',
  OptionalOAuthGuard<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
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

      // Only Note and Poll statuses have editable text content; Announces
      // (reblogs) have no history.
      if (status.type === StatusType.enum.Announce) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const history = await getMastodonStatusEdits(
        database,
        status,
        currentActor?.id
      )

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: history })
    },
    // Public for public statuses; a read or read:statuses token unlocks private
    // ones. matchMode 'any' so either scope satisfies the requirement.
    { matchMode: 'any' }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
