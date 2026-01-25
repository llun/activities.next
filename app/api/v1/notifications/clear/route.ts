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
  'clearNotifications',
  OAuthGuard([Scope.enum.write], async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    // Delete all notifications in batches
    const batchSize = 1000
    let hasMore = true

    while (hasMore) {
      const notifications = await database.getNotifications({
        actorId: currentActor.id,
        limit: batchSize
      })

      if (notifications.length === 0) {
        hasMore = false
        break
      }

      // Delete batch
      await Promise.all(
        notifications.map((notification) =>
          database.deleteNotification(notification.id)
        )
      )

      // If we got fewer than batchSize, we're done
      if (notifications.length < batchSize) {
        hasMore = false
      }
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {}
    })
  })
)
