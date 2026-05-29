import { getDatabase } from '@/lib/database'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getNotificationGroupsEnvelope } from '@/lib/services/notifications/getNotificationGroupsEnvelope'
import { groupNotifications } from '@/lib/services/notifications/groupNotifications'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  group_key: string
}

export const GET = traceApiRoute(
  'getGroupedNotification',
  OAuthGuard<Params>(
    [Scope.enum.read],
    async (req, { currentActor, params }) => {
      const database = getDatabase()
      if (!database) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_500,
          responseStatusCode: 500
        })
      }

      const groupKey = decodeURIComponent((await params).group_key)
      const notifications = await database.getNotificationsForGroupKey({
        actorId: currentActor.id,
        groupKey,
        includeFiltered: true
      })
      if (notifications.length === 0) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const envelope = await getNotificationGroupsEnvelope(
        database,
        groupNotifications(notifications, true),
        currentActor.id
      )

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: envelope })
    }
  )
)
