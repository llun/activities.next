import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { mastodonTypesToInternal } from '@/lib/services/notifications/notificationTypeMapping'
import { Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
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
const ARRAY_QUERY_PARAMS = new Set(['types', 'exclude_types'])

export const OPTIONS = defaultOptions(CORS_HEADERS)

const UnreadCountQueryParams = z.object({
  limit: clampedLimit(MAX_LIMIT, DEFAULT_LIMIT),
  types: z.array(z.string()).optional(),
  exclude_types: z.array(z.string()).optional(),
  account_id: z.string().optional()
})

export const GET = traceApiRoute(
  'getUnreadNotificationsCount',
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
    // Normalize repeated array params (types[], exclude_types[]) to bare keys.
    // Merge values when both bare and bracketed forms appear (e.g. types + types[]).
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

    const parsedParams = UnreadCountQueryParams.safeParse(queryParams)
    if (!parsedParams.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const {
      limit,
      types,
      exclude_types: excludeTypes,
      account_id: accountId
    } = parsedParams.data

    const internalTypes = mastodonTypesToInternal(types)
    const internalExcludeTypes = mastodonTypesToInternal(excludeTypes)

    // account_id is the Mastodon short id of the source actor; sourceActorId is
    // stored as a full URL, so (like the list route) it is matched post-fetch
    // via urlToId rather than in SQL. Fetch up to MAX_LIMIT rows so that
    // matching notifications are not missed if the target account's items fall
    // beyond the first `limit` unread entries; cap the returned count at `limit`.
    if (accountId) {
      const notifications = await database.getNotifications({
        actorId: currentActor.id,
        limit: MAX_LIMIT,
        onlyUnread: true,
        types: internalTypes,
        excludeTypes: internalExcludeTypes
      })
      const count = Math.min(
        notifications.filter((n) => urlToId(n.sourceActorId) === accountId)
          .length,
        limit
      )
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: { count } })
    }

    const count = await database.getNotificationsCount({
      actorId: currentActor.id,
      onlyUnread: true,
      types: internalTypes,
      excludeTypes: internalExcludeTypes,
      limit
    })

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: { count } })
  })
)
