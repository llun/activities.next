import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { getActiveFilters } from '@/lib/services/filters/applyFilters'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonNotification } from '@/lib/services/notifications/getMastodonNotification'
import { groupNotifications } from '@/lib/services/notifications/groupNotifications'
import { mastodonTypesToInternal } from '@/lib/services/notifications/notificationTypeMapping'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 80
const ARRAY_QUERY_PARAMS = new Set(['types', 'exclude_types'])

export const OPTIONS = defaultOptions(CORS_HEADERS)

const NotificationQueryParams = z.object({
  max_id: z.string().optional(),
  since_id: z.string().optional(),
  min_id: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .optional(),
  types: z.array(z.string()).optional(),
  exclude_types: z.array(z.string()).optional(),
  account_id: z.string().optional(),
  include_filtered: z
    .string()
    .transform((val) => {
      const n = val.toLowerCase()
      return n === 'true' || n === '1' || n === 'on'
    })
    .optional(),
  grouped: z
    .string()
    .transform((val) => {
      const n = val.toLowerCase()
      return n === 'true' || n === '1' || n === 'on'
    })
    .optional()
})

export const GET = traceApiRoute(
  'getNotifications',
  OAuthGuard([Scope.enum.read], async (req, { currentActor }) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const url = new URL(req.url)
    // Handle repeated query params (types[], exclude_types[])
    // Normalize keys by removing [] suffix to match Zod schema
    const queryParams: Record<string, string | string[]> = {}
    for (const key of new Set(url.searchParams.keys())) {
      // Normalize key: types[] -> types, exclude_types[] -> exclude_types
      const normalizedKey = key.replace(/\[\]$/, '')
      const allValues = url.searchParams.getAll(key)
      const normalizedValue =
        ARRAY_QUERY_PARAMS.has(normalizedKey) || allValues.length > 1
          ? allValues
          : allValues[0]
      const existing = queryParams[normalizedKey]
      if (existing === undefined) {
        queryParams[normalizedKey] = normalizedValue
      } else {
        queryParams[normalizedKey] = [
          ...(Array.isArray(existing) ? existing : [existing]),
          ...(Array.isArray(normalizedValue)
            ? normalizedValue
            : [normalizedValue])
        ]
      }
    }
    const parsedParams = NotificationQueryParams.safeParse(queryParams)
    if (!parsedParams.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const {
      limit = DEFAULT_LIMIT,
      max_id: maxId,
      min_id: minId,
      since_id: sinceId,
      types,
      exclude_types: excludeTypes,
      account_id: accountId,
      include_filtered: includeFiltered = false,
      grouped = false
    } = parsedParams.data

    // Convert Mastodon type names to internal types for filtering
    const internalTypes = mastodonTypesToInternal(types)
    const internalExcludeTypes = mastodonTypesToInternal(excludeTypes)

    // Fetch notifications
    const notifications = await database.getNotifications({
      actorId: currentActor.id,
      limit,
      maxNotificationId: maxId,
      minNotificationId: minId || sinceId,
      types: internalTypes,
      excludeTypes: internalExcludeTypes,
      includeFiltered
    })

    // Group notifications if requested
    const processedNotifications = groupNotifications(notifications, grouped)

    // Filter by account_id if specified
    const filteredNotifications = accountId
      ? processedNotifications.filter(
          (n) => urlToId(n.sourceActorId) === accountId
        )
      : processedNotifications

    const filterRecords = await getActiveFilters(
      database,
      currentActor.id,
      'notifications'
    )

    // Transform to Mastodon-compatible format
    const mastodonNotifications = (
      await Promise.all(
        filteredNotifications.map((notification) =>
          getMastodonNotification(database, notification, {
            includeGrouping: grouped,
            currentActorId: currentActor.id,
            filterRecords
          })
        )
      )
    ).filter((n) => n !== null)

    // Generate Link headers for pagination
    const host = headerHost(req.headers)
    const pathBase = '/api/v1/notifications'

    // Build query params preserving filters
    const buildPaginationUrl = (cursorParam: string, cursorValue: string) => {
      const params = new URLSearchParams()
      params.set('limit', limit.toString())
      params.set(cursorParam, cursorValue)

      // Preserve filters
      if (types) {
        types.forEach((type) => params.append('types[]', type))
      }
      if (excludeTypes) {
        excludeTypes.forEach((type) => params.append('exclude_types[]', type))
      }
      if (accountId) {
        params.set('account_id', accountId)
      }
      if (includeFiltered) {
        params.set('include_filtered', 'true')
      }
      if (grouped) {
        params.set('grouped', 'true')
      }

      return `<https://${host}${pathBase}?${params.toString()}>; rel="${cursorParam === 'max_id' ? 'next' : 'prev'}"`
    }

    // Pagination cursors come from the notification page scanned from the
    // DB (post account_id filter, but pre hide-filter / pre groupedAccount
    // hydration) so that pages whose statuses are entirely hide-filtered
    // still advertise next/prev links to keep the client paginating.
    const paginationCandidates = filteredNotifications
    const nextLink =
      paginationCandidates.length > 0
        ? buildPaginationUrl(
            'max_id',
            paginationCandidates[paginationCandidates.length - 1].id
          )
        : null

    const prevLink =
      paginationCandidates.length > 0
        ? buildPaginationUrl('min_id', paginationCandidates[0].id)
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
  })
)

export const POST = traceApiRoute(
  'clearAllNotifications',
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
  })
)
