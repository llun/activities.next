import { getDatabase } from '@/lib/database'
import { getActiveFilters } from '@/lib/services/filters/applyFilters'
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

      const rawGroupKey = (await params).group_key
      const groupKey = rawGroupKey.startsWith('ungrouped-')
        ? rawGroupKey.slice('ungrouped-'.length)
        : rawGroupKey
      // Mirror the list endpoint: hide policy-filtered notifications by default.
      const notifications = await database.getNotificationsForGroupKey({
        actorId: currentActor.id,
        groupKey,
        includeFiltered: false
      })
      if (notifications.length === 0) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      // Apply the same content filters as the list route.
      const filterRecords = await getActiveFilters(
        database,
        currentActor.id,
        'notifications'
      )

      // Disable grouping for ungrouped- keys so the stored groupKey is not used
      // and the returned group_key matches the client's request.
      const envelope = await getNotificationGroupsEnvelope(
        database,
        groupNotifications(
          notifications,
          !rawGroupKey.startsWith('ungrouped-')
        ),
        currentActor.id,
        filterRecords
      )

      // If the content filter or missing status removed the only group, return 404
      // rather than 200 with an empty notification_groups array.
      if (envelope.notification_groups.length === 0) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: envelope })
    }
  )
)
