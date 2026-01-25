import { follow } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/requests/getActorPerson'
import { Scope } from '@/lib/database/types/oauth'
import { FollowStatus } from '@/lib/models/follow'
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
  'followAccount',
  OAuthGuard<Params>([Scope.enum.write], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId) return apiErrorResponse(400)

    const targetActorId = idToUrl(encodedAccountId)

    // Check if target actor exists
    const person = await getActorPerson({ actorId: targetActorId })
    if (!person) return apiErrorResponse(404)

    // Check if already following
    const existingFollow = await database.getAcceptedOrRequestedFollow({
      actorId: currentActor.id,
      targetActorId
    })

    if (!existingFollow) {
      const followItem = await database.createFollow({
        actorId: currentActor.id,
        targetActorId,
        status: FollowStatus.enum.Requested,
        inbox: `${currentActor.id}/inbox`,
        sharedInbox: `https://${currentActor.domain}/inbox`
      })
      await follow(followItem.id, currentActor, targetActorId)
    }

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
