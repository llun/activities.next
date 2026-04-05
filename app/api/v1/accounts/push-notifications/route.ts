import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const PushNotificationSettingsRequest = z.object({
  follow_request: z.boolean().optional(),
  follow: z.boolean().optional(),
  like: z.boolean().optional(),
  mention: z.boolean().optional(),
  reply: z.boolean().optional(),
  reblog: z.boolean().optional(),
  activity_import: z.boolean().optional(),
  actorId: z.string().optional()
})

export const POST = traceApiRoute(
  'updatePushNotifications',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const body = await req.json()
    const parsed = PushNotificationSettingsRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(400)
    }

    const targetActorId = parsed.data.actorId || currentActor.id

    // Verify the user has access to this actor
    if (currentActor.account) {
      const actors = await database.getActorsForAccount({
        accountId: currentActor.account.id
      })
      const hasAccess = actors.some((actor) => actor.id === targetActorId)
      if (!hasAccess) {
        return apiErrorResponse(403)
      }
    }

    const { actorId: _actorId, ...pushNotifications } = parsed.data

    // Filter out undefined values
    const filteredNotifications = Object.fromEntries(
      Object.entries(pushNotifications).filter(([, v]) => v !== undefined)
    ) as {
      follow_request?: boolean
      follow?: boolean
      like?: boolean
      mention?: boolean
      reply?: boolean
      reblog?: boolean
      activity_import?: boolean
    }

    await database.updateActor({
      actorId: targetActorId,
      pushNotifications: filteredNotifications
    })

    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { status: 'OK' }
    })
  })
)
