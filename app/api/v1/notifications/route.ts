import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonNotification } from '@/lib/services/notifications/getMastodonNotification'
import { groupNotifications } from '@/lib/services/notifications/groupNotifications'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 80

export const OPTIONS = defaultOptions(CORS_HEADERS)

const NotificationQueryParams = z.object({
  max_id: z.string().optional(),
  since_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: z.coerce
    .number()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .optional(),
  types: z.array(z.string()).optional(),
  exclude_types: z.array(z.string()).optional(),
  account_id: z.string().optional(),
  grouped: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional()
})

export const GET = OAuthGuard(
  [Scope.enum.read],
  async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams.entries())
    const parsedParams = NotificationQueryParams.parse(queryParams)

    const {
      limit = DEFAULT_LIMIT,
      max_id: maxId,
      min_id: minId,
      since_id: sinceId,
      types,
      exclude_types: excludeTypes,
      account_id: accountId,
      grouped = false
    } = parsedParams

    // Convert Mastodon types to internal types for filtering
    const internalTypes = types?.map((type) => {
      if (type === 'favourite') return 'like'
      if (type === 'reblog') return 'reblog'
      return type
    })

    const internalExcludeTypes = excludeTypes?.map((type) => {
      if (type === 'favourite') return 'like'
      if (type === 'reblog') return 'reblog'
      return type
    })

    // Fetch notifications
    const notifications = await database.getNotifications({
      actorId: currentActor.id,
      limit,
      maxNotificationId: maxId,
      minNotificationId: minId || sinceId,
      types: internalTypes as any,
      excludeTypes: internalExcludeTypes as any
    })

    // Group notifications if requested
    const processedNotifications = groupNotifications(notifications, grouped)

    // Filter by account_id if specified
    const filteredNotifications = accountId
      ? processedNotifications.filter(
          (n) => urlToId(n.sourceActorId) === accountId
        )
      : processedNotifications

    // Transform to Mastodon-compatible format
    const mastodonNotifications = (
      await Promise.all(
        filteredNotifications.map((notification) =>
          getMastodonNotification(database, notification, {
            includeGrouping: grouped
          })
        )
      )
    ).filter((n) => n !== null)

    // Generate Link headers for pagination
    const host = headerHost(req.headers)
    const pathBase = '/api/v1/notifications'

    const nextLink =
      mastodonNotifications.length > 0
        ? `<https://${host}${pathBase}?limit=${limit}&max_id=${mastodonNotifications[mastodonNotifications.length - 1].id}>; rel="next"`
        : null

    const prevLink =
      mastodonNotifications.length > 0
        ? `<https://${host}${pathBase}?limit=${limit}&min_id=${mastodonNotifications[0].id}>; rel="prev"`
        : null

    const links = [nextLink, prevLink].filter(Boolean).join(', ')

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: mastodonNotifications,
      additionalHeaders: [
        ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
      ]
    })
  }
)

export const POST = OAuthGuard(
  [Scope.enum.write],
  async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    // Fetch all notifications for the current actor
    const notifications = await database.getNotifications({
      actorId: currentActor.id,
      limit: 1000 // Reasonable limit for clear all operation
    })

    // Delete all notifications
    await Promise.all(
      notifications.map((notification) =>
        database.deleteNotification(notification.id)
      )
    )

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {}
    })
  }
)
