import { toStatusActivityData } from '@/lib/services/fitness/activityData'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { StatusType } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

interface Params {
  id: string
}

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getStatusActivity',
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { database, params } = context
    const encodedStatusId = (await params).id
    if (!encodedStatusId) return apiErrorResponse(404)

    const statusId = idToUrl(encodedStatusId)
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status) return apiErrorResponse(404)

    const targetStatusId =
      status.type === StatusType.enum.Announce
        ? status.originalStatus.id
        : status.id
    const activity = await database.getFitnessActivityByStatusId({
      statusId: targetStatusId
    })

    if (!activity) return apiErrorResponse(404)

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        statusId: targetStatusId,
        activity: toStatusActivityData(activity)
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
