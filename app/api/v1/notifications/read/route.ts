import { getDatabase } from '@/lib/database'
import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'markNotificationsRead',
  OAuthGuard([Scope.enum.write], async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const body = await req.json()
    const notificationIds = body.notification_ids || []

    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return apiErrorResponse(400)
    }

    // Verify all notifications belong to the current actor
    const notifications = await database.getNotifications({
      actorId: currentActor.id,
      limit: notificationIds.length,
      offset: 0,
      ids: notificationIds
    })

    const validIds = notifications
      .filter((n) => notificationIds.includes(n.id))
      .map((n) => n.id)

    if (validIds.length > 0) {
      await database.markNotificationsRead({
        notificationIds: validIds
      })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { success: true, marked_read: validIds.length }
    })
  })
)
