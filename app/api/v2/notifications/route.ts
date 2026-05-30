import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { getActiveFilters } from '@/lib/services/filters/applyFilters'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import {
  getNotificationGroupsEnvelope,
  prepareGroupedNotifications
} from '@/lib/services/notifications/getNotificationGroupsEnvelope'
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
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 80
// Over-fetch row multiplier: ensures that after grouping we have enough distinct
// groups for the requested page even if many rows share the same groupKey.
const GROUP_OVERSCAN = 5
const ARRAY_QUERY_PARAMS = new Set([
  'types',
  'exclude_types',
  'grouped_types',
  'supported_types'
])

export const OPTIONS = defaultOptions(CORS_HEADERS)

const QueryParams = z.object({
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
  grouped_types: z.array(z.string()).optional(),
  account_id: z.string().optional(),
  include_filtered: z
    .string()
    .transform((val) => {
      const n = val.toLowerCase()
      return n === 'true' || n === '1' || n === 'on'
    })
    .optional()
})

export const GET = traceApiRoute(
  'getGroupedNotifications',
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
      max_id: maxId,
      min_id: minId,
      since_id: sinceId,
      types,
      exclude_types: excludeTypes,
      grouped_types: groupedTypesMastodon,
      account_id: accountId,
      include_filtered: includeFiltered = false
    } = parsed.data

    // Over-fetch rows so that after grouping we produce at least `limit` groups.
    const notifications = await database.getNotifications({
      actorId: currentActor.id,
      limit: limit * GROUP_OVERSCAN,
      maxNotificationId: maxId,
      minNotificationId: minId || sinceId,
      types: mastodonTypesToInternal(types),
      excludeTypes: mastodonTypesToInternal(excludeTypes),
      includeFiltered
    })

    const filtered = accountId
      ? notifications.filter((n) => urlToId(n.sourceActorId) === accountId)
      : notifications

    const internalGroupedTypes = groupedTypesMastodon
      ? new Set(
          mastodonTypesToInternal(groupedTypesMastodon) as NotificationType[]
        )
      : undefined

    // include_filtered controls only the DB-level filter flag (NotificationPolicy).
    // Content filters (keyword/status hide rules) are applied regardless.
    const filterRecords = await getActiveFilters(
      database,
      currentActor.id,
      'notifications'
    )

    // Prepare groups (follow-groupKey injection + groupNotifications) and slice
    // to limit BEFORE resolving accounts/statuses to avoid unnecessary DB work.
    const groupedSlice = prepareGroupedNotifications(
      filtered,
      internalGroupedTypes
    ).slice(0, limit)
    const envelope = await getNotificationGroupsEnvelope(
      database,
      groupedSlice,
      currentActor.id,
      filterRecords
    )

    // Pagination cursor for "next": use the last raw notification BEFORE the first
    // gap (first notification not part of any returned group). This prevents
    // skipping intervening groups when a returned group spans non-contiguous rows.
    const sliceNotificationIds = new Set(
      groupedSlice.flatMap((g) => [g.id, ...(g.groupedIds ?? [])])
    )
    const firstGapIndex = filtered.findIndex(
      (n) => !sliceNotificationIds.has(n.id)
    )
    const maxIdCursorNotification =
      firstGapIndex > 0
        ? filtered[firstGapIndex - 1]
        : firstGapIndex === -1
          ? filtered[filtered.length - 1]
          : filtered[0]
    const host = headerHost(req.headers)
    const pathBase = '/api/v2/notifications'
    const buildLink = (cursorParam: string, cursorValue: string) => {
      const params = new URLSearchParams(url.searchParams)
      params.delete('max_id')
      params.delete('min_id')
      params.delete('since_id')
      params.set('limit', limit.toString())
      params.set(cursorParam, cursorValue)
      return `<https://${host}${pathBase}?${params.toString()}>; rel="${cursorParam === 'max_id' ? 'next' : 'prev'}"`
    }
    const links =
      groupedSlice.length > 0 && maxIdCursorNotification
        ? [
            buildLink('max_id', maxIdCursorNotification.id),
            buildLink('min_id', filtered[0].id)
          ].join(', ')
        : ''

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: envelope,
      additionalHeaders: links ? [['Link', links] as [string, string]] : []
    })
  })
)
