import { getDatabase } from '@/lib/database'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  group_key: string
}

export const GET = traceApiRoute(
  'getGroupedNotificationAccounts',
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

      // Distinct source actors, most-recent-first (notifications come ordered).
      const seen = new Set<string>()
      const orderedActorIds: string[] = []
      for (const notification of notifications) {
        if (seen.has(notification.sourceActorId)) continue
        seen.add(notification.sourceActorId)
        orderedActorIds.push(notification.sourceActorId)
      }

      const accounts =
        orderedActorIds.length > 0
          ? await database.getMastodonActorsFromIds({ ids: orderedActorIds })
          : []

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: accounts })
    }
  )
)
