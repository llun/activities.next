import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { getActiveFilters } from '@/lib/services/filters/applyFilters'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { collectNotificationGroups } from '@/lib/services/notifications/collectNotificationGroups'
import { getNotificationGroupsEnvelope } from '@/lib/services/notifications/getNotificationGroupsEnvelope'
import {
  DEFAULT_GROUPABLE_TYPES,
  mastodonTypesToInternal
} from '@/lib/services/notifications/notificationTypeMapping'
import { NotificationType, Scope } from '@/lib/types/database/operations'
import { clampedLimit } from '@/lib/utils/clampedLimit'
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
// Bound on outer collect+suppress rounds so a window full of suppressed unread
// groups can't make the badge scan unbounded rows.
const MAX_COLLECT_ROUNDS = 5
const ARRAY_QUERY_PARAMS = new Set(['types', 'exclude_types', 'grouped_types'])

export const OPTIONS = defaultOptions(CORS_HEADERS)

const QueryParams = z.object({
  limit: clampedLimit(MAX_LIMIT, DEFAULT_LIMIT),
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
      limit,
      types,
      exclude_types: excludeTypes,
      grouped_types: groupedTypesMastodon,
      account_id: accountId
    } = parsed.data

    // Default to Mastodon's groupable types so mentions/replies are counted
    // individually when grouped_types is omitted (matches the list endpoint).
    const internalGroupedTypes = groupedTypesMastodon
      ? new Set(
          mastodonTypesToInternal(groupedTypesMastodon) as NotificationType[]
        )
      : new Set(DEFAULT_GROUPABLE_TYPES)

    // Count only groups the list endpoint would actually show: build the same
    // envelope (with content filters) so hide-filtered, deleted-status, or
    // unresolvable-actor groups don't inflate the unread badge.
    const filterRecords = await getActiveFilters(
      database,
      currentActor.id,
      'notifications'
    )

    // Iteratively collect+suppress until we reach `limit` SURVIVING unread groups
    // or run out of rows. Counting survivors (post-envelope) and looping past
    // suppressed windows prevents both bursty-group undercounts and the case
    // where the newest unread groups are all hidden/deleted while older visible
    // unread groups still exist. Survivors are deduped by group_key across loops.
    const survivingKeys = new Set<string>()
    let cursor: string | undefined
    for (let round = 0; round < MAX_COLLECT_ROUNDS; round += 1) {
      const { groups, exhausted, lastScannedId } =
        await collectNotificationGroups({
          database,
          baseQuery: {
            actorId: currentActor.id,
            onlyUnread: true,
            types: mastodonTypesToInternal(types),
            excludeTypes: mastodonTypesToInternal(excludeTypes)
          },
          limit,
          batchSize: MAX_LIMIT,
          accountId,
          groupedTypes: internalGroupedTypes,
          startCursor: cursor
        })
      const envelope = await getNotificationGroupsEnvelope(
        database,
        groups,
        currentActor.id,
        filterRecords
      )
      for (const group of envelope.notification_groups) {
        survivingKeys.add(group.group_key)
      }
      if (survivingKeys.size >= limit || exhausted || !lastScannedId) break
      cursor = lastScannedId
    }
    const count = Math.min(survivingKeys.size, limit)

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: { count } })
  })
)
