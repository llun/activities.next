import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
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
  'getAccount',
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { database, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId) {
      return apiErrorResponse(400)
    }
    const id = idToUrl(encodedAccountId)
    const actor = await database.getMastodonActorFromId({
      id
    })
    if (!actor) {
      return apiErrorResponse(404)
    }
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: actor
    })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
