import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
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
  'getStatusHistory',
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { database, params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId) return apiErrorResponse(404)

    const statusId = idToUrl(encodedStatusId)
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status) return apiErrorResponse(404)

    // Only note and poll statuses have text content
    if (status.type === 'Announce') {
      return apiErrorResponse(404)
    }

    // Return current version as history (edit history not tracked)
    const history = [
      {
        content: status.text ?? '',
        spoiler_text: status.summary ?? '',
        sensitive: Boolean(status.summary),
        created_at: getISOTimeUTC(status.createdAt),
        account: await database.getMastodonActorFromId({ id: status.actorId }),
        emojis: [],
        media_attachments: []
      }
    ]

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: history
    })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
