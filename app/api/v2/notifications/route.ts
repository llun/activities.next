import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { buildNotificationGroupsEnvelope } from '@/lib/services/notifications/getNotificationGroupsEnvelope'
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

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 40
const MAX_LIMIT = 80
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
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .optional(),
  types: z.array(z.string()).optional(),
  exclude_types: z.array(z.string()).optional(),
  account_id: z.string().optional(),
  include_filtered: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
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
      max_id: maxId,
      min_id: minId,
      since_id: sinceId,
      types,
      exclude_types: excludeTypes,
      account_id: accountId,
      include_filtered: includeFiltered = false
    } = parsed.data

    const notifications = await database.getNotifications({
      actorId: currentActor.id,
      limit,
      maxNotificationId: maxId,
      minNotificationId: minId || sinceId,
      types: mastodonTypesToInternal(types),
      excludeTypes: mastodonTypesToInternal(excludeTypes),
      includeFiltered
    })

    const filtered = accountId
      ? notifications.filter((n) => urlToId(n.sourceActorId) === accountId)
      : notifications

    const envelope = await buildNotificationGroupsEnvelope(
      database,
      filtered,
      currentActor.id
    )

    // Pagination links from the raw notification page (pre-grouping), mirroring
    // the v1 list route so clients keep paginating.
    const host = headerHost(req.headers)
    const pathBase = '/api/v2/notifications'
    const buildLink = (cursorParam: string, cursorValue: string) => {
      const params = new URLSearchParams()
      params.set('limit', limit.toString())
      params.set(cursorParam, cursorValue)
      if (includeFiltered) params.set('include_filtered', 'true')
      return `<https://${host}${pathBase}?${params.toString()}>; rel="${cursorParam === 'max_id' ? 'next' : 'prev'}"`
    }
    const links =
      filtered.length > 0
        ? [
            buildLink('max_id', filtered[filtered.length - 1].id),
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
