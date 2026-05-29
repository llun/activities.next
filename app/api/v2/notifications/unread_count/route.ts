import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { groupNotifications } from '@/lib/services/notifications/groupNotifications'
import { mastodonTypesToInternal } from '@/lib/services/notifications/notificationTypeMapping'
import { NotificationType, Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000
const ARRAY_QUERY_PARAMS = new Set(['types', 'exclude_types', 'grouped_types'])

export const OPTIONS = defaultOptions(CORS_HEADERS)

const QueryParams = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .optional(),
  types: z.array(z.string()).optional(),
  exclude_types: z.array(z.string()).optional(),
  grouped_types: z.array(z.string()).optional(),
  account_id: z.string().optional()
})

export const GET = traceApiRoute(
  'getGroupedUnreadNotificationsCount',
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
    const queryParams: Record<string, string | string[]> = {}
    for (const key of new Set(url.searchParams.keys())) {
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

    const parsed = QueryParams.safeParse(queryParams)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const {
      limit = DEFAULT_LIMIT,
      types,
      exclude_types: excludeTypes,
      grouped_types: groupedTypesMastodon,
      account_id: accountId
    } = parsed.data

    const internalGroupedTypes = groupedTypesMastodon
      ? new Set(
          mastodonTypesToInternal(groupedTypesMastodon) as NotificationType[]
        )
      : undefined

    // Fetch MAX_LIMIT rows so grouping produces an accurate group count regardless
    // of how many individual rows belong to the same group. We cap after grouping.
    const notifications = await database.getNotifications({
      actorId: currentActor.id,
      limit: MAX_LIMIT,
      onlyUnread: true,
      types: mastodonTypesToInternal(types),
      excludeTypes: mastodonTypesToInternal(excludeTypes)
    })
    const filtered = accountId
      ? notifications.filter((n) => urlToId(n.sourceActorId) === accountId)
      : notifications
    // Apply same follow-grouping as the main v2 envelope.
    const canGroupFollows =
      !internalGroupedTypes ||
      internalGroupedTypes.has(NotificationType.enum.follow)
    const prepared = filtered.map((n) =>
      n.type === NotificationType.enum.follow && !n.groupKey && canGroupFollows
        ? { ...n, groupKey: 'follow' }
        : n
    )
    const count = Math.min(
      groupNotifications(prepared, true, internalGroupedTypes).length,
      limit
    )

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: { count } })
  })
)
