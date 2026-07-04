import { getDatabase } from '@/lib/database'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'clearNotifications',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:notifications']],
    async (req, { currentActor }) => {
      const database = getDatabase()
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }

      // Delete all notifications in batches
      const batchSize = 1000

      while (true) {
        const notifications = await database.getNotifications({
          actorId: currentActor.id,
          limit: batchSize,
          includeFiltered: true
        })

        if (notifications.length === 0) {
          break
        }

        // Delete sequentially to avoid concurrent-write contention on SQLite
        for (const notification of notifications) {
          await database.deleteNotification(notification.id)
        }

        // If we got fewer than batchSize, we're done
        if (notifications.length < batchSize) {
          break
        }
      }

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
