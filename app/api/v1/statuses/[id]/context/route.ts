import { Scope } from '@/lib/database/types/oauth'
import { StatusType } from '@/lib/models/status'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
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
  'getStatusContext',
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId) return apiErrorResponse(404)

    const { database, currentActor } = context
    const statusId = idToUrl(encodedStatusId)

    const status = await database.getStatus({ statusId })
    if (!status || status.type === StatusType.enum.Announce) {
      return apiErrorResponse(404)
    }

    const [ancestor, descendants] = await Promise.all([
      status.reply
        ? database
            .getStatus({ statusId: status.reply })
            .then((status) =>
              status
                ? getMastodonStatus(database, status, currentActor.id)
                : null
            )
        : Promise.resolve(null),
      database
        .getStatusReplies({ statusId })
        .then((statuses) =>
          Promise.all(
            statuses.map((status) =>
              getMastodonStatus(database, status, currentActor.id)
            )
          )
        )
    ])

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        ancestors: ancestor ? [ancestor] : [],
        descendants: descendants.filter(Boolean)
      }
    })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
