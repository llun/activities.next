import { getDatabase } from '@/lib/database'
import {
  applyFiltersToStatus,
  getActiveFilters
} from '@/lib/services/filters/applyFilters'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
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
  'getGroupedNotificationAccounts',
  // Mastodon's grouped-notifications docs require write:notifications for this
  // endpoint (unusual for a GET, but per spec), unlike the read-scoped list/
  // single/unread endpoints.
  OAuthGuard<Params>(
    [Scope.enum.write],
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
      // ungrouped-{id} keys use the notification id as the DB lookup key.
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

      // Resolve referenced statuses to mirror the envelope's group suppression.
      // The envelope drops a group when its status_id is unresolvable (deleted or
      // not visible) regardless of active filters, so this check must run
      // unconditionally; the hide-filter check below additionally needs the records.
      const filterRecords = await getActiveFilters(
        database,
        currentActor.id,
        'notifications'
      )
      const statusIds = [
        ...new Set(
          notifications
            .map((n) => n.statusId)
            .filter((id): id is string => Boolean(id))
        )
      ]
      if (statusIds.length > 0) {
        const statuses = await database.getStatusesByIds({
          statusIds,
          currentActorId: currentActor.id,
          visibleToActorId: currentActor.id,
          withReplies: false
        })
        // If any referenced status is deleted/invisible, the envelope suppresses
        // the group — return 404 here too for consistency.
        if (statuses.length < statusIds.length) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_404,
            responseStatusCode: 404
          })
        }
        // Hide-filter check requires active filter records.
        if (filterRecords.length > 0) {
          const isHidden = statuses.some((s) =>
            applyFiltersToStatus(s, filterRecords).some(
              (m) => m.filter.filter_action === 'hide'
            )
          )
          if (isHidden) {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: ERROR_404,
              responseStatusCode: 404
            })
          }
        }
      }

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

      // Mirror the envelope: if no sampled account resolves (all deleted), the
      // group is suppressed everywhere else — return 404 instead of an empty list.
      if (accounts.length === 0) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: accounts })
    }
  )
)
