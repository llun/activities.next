import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
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

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000
const ARRAY_QUERY_PARAMS = new Set(['types', 'exclude_types', 'grouped_types'])

export const OPTIONS = defaultOptions(CORS_HEADERS)

const QueryParams = z.object({
  limit: z.coerce
    .number()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .optional(),
  types: z.array(z.string()).optional(),
  exclude_types: z.array(z.string()).optional()
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
      queryParams[normalizedKey] =
        ARRAY_QUERY_PARAMS.has(normalizedKey) || allValues.length > 1
          ? allValues
          : allValues[0]
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
      exclude_types: excludeTypes
    } = parsed.data

    // Mastodon's grouped unread_count counts unread groups (capped).
    const notifications = await database.getNotifications({
      actorId: currentActor.id,
      limit,
      onlyUnread: true,
      types: mastodonTypesToInternal(types),
      excludeTypes: mastodonTypesToInternal(excludeTypes)
    })
    const count = groupNotifications(notifications, true).length

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: { count } })
  })
)
