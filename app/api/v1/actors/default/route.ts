import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const SetDefaultActorRequest = z.object({
  actorId: z.string().min(1)
})

export const POST = traceApiRoute(
  'setDefaultActor',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    if (!currentActor.account) {
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    const body = await req.json()
    const parsed = SetDefaultActorRequest.safeParse(body)

    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const { actorId } = parsed.data

    const actors = await database.getActorsForAccount({
      accountId: currentActor.account.id
    })
    const validActor = actors.find((actor) => actor.id === actorId)
    if (!validActor) {
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: { error: 'Actor not found or not owned by account' },
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    }

    await database.setDefaultActor({
      accountId: currentActor.account.id,
      actorId
    })

    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: {
        defaultActorId: actorId,
        id: validActor.id,
        username: validActor.username,
        domain: validActor.domain
      }
    })
  })
)
