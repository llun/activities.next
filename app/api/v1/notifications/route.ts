import { getDatabase } from '@/lib/database'
import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { groupNotifications } from '@/lib/services/notifications/groupNotifications'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const ITEMS_PER_PAGE = 25

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = OAuthGuard(
  [Scope.enum.read],
  async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const url = new URL(req.url)
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const offset = (page - 1) * ITEMS_PER_PAGE

    // Fetch notifications
    const notifications = await database.getNotifications({
      actorId: currentActor.id,
      limit: ITEMS_PER_PAGE,
      offset
    })

    // Group notifications by groupKey
    const groupedNotifications = groupNotifications(notifications)

    // Transform to Mastodon-compatible format
    const mastodonNotifications = await Promise.all(
      groupedNotifications.map(async (notification) => {
        const account = await database.getMastodonActorFromId({
          id: notification.sourceActorId
        })

        let status = null
        if (notification.statusId) {
          status = await database.getStatus({
            statusId: notification.statusId,
            withReplies: false
          })
        }

        // Get additional actors for grouped notifications
        let groupedAccounts = null
        if (
          notification.groupedActors &&
          notification.groupedActors.length > 1
        ) {
          groupedAccounts = await Promise.all(
            notification.groupedActors
              .slice(0, 3)
              .map((actorId) =>
                database.getMastodonActorFromId({ id: actorId })
              )
          )
        }

        return {
          id: notification.id,
          type: notification.type,
          created_at: new Date(notification.createdAt).toISOString(),
          account,
          status: status || undefined,
          is_read: notification.isRead,
          grouped_count: notification.groupedCount,
          grouped_accounts: groupedAccounts?.filter(Boolean)
        }
      })
    )

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: mastodonNotifications.filter((n) => n.account)
    })
  }
)
