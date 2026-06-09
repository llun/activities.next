import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

const MarkNotificationsReadRequest = z.object({
  notification_ids: z.array(z.string().min(1)).min(1)
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'markNotificationsRead',
  OAuthGuard([Scope.enum.write], async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const body = await req.json().catch(() => null)
    const parsed = MarkNotificationsReadRequest.safeParse(body)

    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const notificationIds = parsed.data.notification_ids

    // Verify all notifications belong to the current actor (include filtered so
    // notifications returned via include_filtered=true can also be marked read)
    const notifications = await database.getNotifications({
      actorId: currentActor.id,
      limit: notificationIds.length,
      offset: 0,
      ids: notificationIds,
      includeFiltered: true
    })

    const validIds = notifications
      .filter((n) => notificationIds.includes(n.id))
      .map((n) => n.id)

    if (validIds.length > 0) {
      await database.markNotificationsRead({ notificationIds: validIds })
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { success: true, marked_read: validIds.length }
    })
  })
)
