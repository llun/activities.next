import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiErrorResponse, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const EmailNotificationSettingsRequest = z.object({
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
  'updateEmailNotifications',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    let body
    try {
      body = await req.json()
    } catch {
      return apiErrorResponse(400)
    }

    const parsed = EmailNotificationSettingsRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(400)
    }

    const targetActorId = parsed.data.actorId || currentActor.id

    if (targetActorId !== currentActor.id) {
      if (!currentActor.account) {
        return apiErrorResponse(403)
      }

      const actors = await database.getActorsForAccount({
        accountId: currentActor.account.id
      })
      const hasAccess = actors.some((actor) => actor.id === targetActorId)
      if (!hasAccess) {
        return apiErrorResponse(403)
      }
    }

    const { actorId: _actorId, ...updates } = parsed.data

    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    )

    const settings = await database.getActorSettings({ actorId: targetActorId })

    await database.updateActor({
      actorId: targetActorId,
      emailNotifications: {
        ...settings?.emailNotifications,
        ...filteredUpdates
      }
    })

    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { status: 'OK' }
    })
  })
)
