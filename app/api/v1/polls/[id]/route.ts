import { OptionalOAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Scope } from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_500,
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
  'getMastodonPoll',
  OptionalOAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedPollId = (await params).id
    const statusId = idToUrl(encodedPollId)
    const status = await database.getStatus({
      statusId,
      currentActorId: currentActor?.id,
      withReplies: false
    })

    if (!status || status.type !== StatusType.enum.Poll) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    // getStatus loads by id; canActorReadStatus is the visibility authority.
    const hasAccess = await canActorReadStatus({
      database,
      status,
      currentActor
    })
    if (!hasAccess) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    const mastodonStatus = await getMastodonStatus(
      database,
      status,
      currentActor?.id
    )
    if (!mastodonStatus?.poll) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: mastodonStatus.poll
    })
  })
)
