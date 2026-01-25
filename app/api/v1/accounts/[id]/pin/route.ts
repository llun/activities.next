import { Scope } from '@/lib/database/types/oauth'
import { getRelationship } from '@/lib/services/accounts/relationship'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
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
  'pinAccount',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId) return apiErrorResponse(400)

    const targetActorId = idToUrl(encodedAccountId)

    // Pin/endorse not yet implemented - return relationship with endorsed: false
    // TODO: Implement endorsement functionality

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
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
