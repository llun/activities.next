import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { getActiveFilters } from '@/lib/services/filters/applyFilters'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { collectNotificationGroups } from '@/lib/services/notifications/collectNotificationGroups'
import {
  NotificationGroupsEnvelope,
  getNotificationGroupsEnvelope,
  prepareGroupedNotifications,
  toPartialAccountWithAvatar
} from '@/lib/services/notifications/getNotificationGroupsEnvelope'
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
  limit: clampedLimit(MAX_LIMIT, DEFAULT_LIMIT),
  types: z.array(z.string()).optional(),
  exclude_types: z.array(z.string()).optional(),
  grouped_types: z.array(z.string()).optional(),
  account_id: z.string().optional(),
  expand_accounts: z.enum(['full', 'partial_avatars']).optional(),
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
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:notifications']],
    async (req, { currentActor }) => {
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
        max_id: maxId,
        min_id: minId,
        since_id: sinceId,
        types,
        exclude_types: excludeTypes,
        grouped_types: groupedTypesMastodon,
        account_id: accountId,
        expand_accounts: expandAccounts = 'full',
        include_filtered: includeFiltered = false
      } = parsed.data

      // When grouped_types is omitted, fall back to Mastodon's default groupable
      // types (favourite/reblog/follow) so mentions/replies are not collapsed.
      const internalGroupedTypes = groupedTypesMastodon
        ? new Set(
            mastodonTypesToInternal(groupedTypesMastodon) as NotificationType[]
          )
        : new Set(DEFAULT_GROUPABLE_TYPES)

      // Iteratively fetch+group until we have `limit` distinct groups (or the
      // source is exhausted), so a single bursty group can't underfill the page
      // and account_id paging scans past bursts from other accounts.
      const {
        rawNotifications: filtered,
        exhausted,
        lastScannedId
      } = await collectNotificationGroups({
        database,
        baseQuery: {
          actorId: currentActor.id,
          // The grouped v2 path fetches in DESC batches (collectNotificationGroups
          // advances max_id by the oldest row), so its lower bound stays
          // since-semantics — driving it as min_id would flip getNotifications to
          // ascending and break the batching. Adjacent-page min_id for grouped
          // notifications is a separate change.
          sinceNotificationId: minId || sinceId,
          types: mastodonTypesToInternal(types),
          excludeTypes: mastodonTypesToInternal(excludeTypes),
          includeFiltered
        },
        limit,
        batchSize: limit * GROUP_OVERSCAN,
        accountId,
        groupedTypes: internalGroupedTypes,
        startCursor: maxId
      })

      // include_filtered controls only the DB-level filter flag (NotificationPolicy).
      // Content filters (keyword/status hide rules) are applied regardless.
      const filterRecords = await getActiveFilters(
        database,
        currentActor.id,
        'notifications'
      )

      // Build the envelope over ALL accumulated groups, then slice the SURVIVING
      // groups to `limit`. Slicing before the envelope would let hide-filtered,
      // deleted, or actorless groups (which the envelope drops) consume the page
      // limit and underfill — or empty — a page while visible groups exist later.
      const allGroups = prepareGroupedNotifications(
        filtered,
        internalGroupedTypes
      )
      const fullEnvelope = await getNotificationGroupsEnvelope(
        database,
        allGroups,
        currentActor.id,
        filterRecords
      )
      const survivingGroups = fullEnvelope.notification_groups.slice(0, limit)
      const keptStatusIds = new Set(
        survivingGroups.map((g) => g.status_id).filter(Boolean)
      )
      const keptActorIds = new Set(
        survivingGroups.flatMap((g) => g.sample_account_ids)
      )
      const keptAccounts = fullEnvelope.accounts.filter((a) =>
        keptActorIds.has(a.id)
      )
      const keptStatuses = fullEnvelope.statuses.filter((s) =>
        keptStatusIds.has(s.id)
      )
      // expand_accounts=partial_avatars: only each group's most recent account
      // (the first sample id — groups are built newest-member-first) is rendered
      // in full; every other sampled account ships as a truncated
      // PartialAccountWithAvatar so bursty groups don't duplicate full accounts.
      const fullAccountIds = new Set(
        survivingGroups
          .map((group) => group.sample_account_ids[0])
          .filter((id): id is string => Boolean(id))
      )
      const envelope: NotificationGroupsEnvelope =
        expandAccounts === 'partial_avatars'
          ? {
              notification_groups: survivingGroups,
              accounts: keptAccounts.filter((a) => fullAccountIds.has(a.id)),
              partial_accounts: keptAccounts
                .filter((a) => !fullAccountIds.has(a.id))
                .map(toPartialAccountWithAvatar),
              statuses: keptStatuses
            }
          : {
              notification_groups: survivingGroups,
              accounts: keptAccounts,
              statuses: keptStatuses
            }

      // Pagination cursors anchor on the returned groups' most-recent notification
      // ids. Groups are ordered by most-recent member, so the last returned group's
      // most_recent id is newer than every not-yet-shown group — using it as max_id
      // never skips a group (it can only re-show the last group's older members,
      // which clients merge via page_min_id). This also steps past leading rows that
      // were hidden by envelope suppression. When suppression empties the page but
      // the source isn't exhausted, fall back to the oldest collected row so the
      // client keeps paging toward the visible groups further down the timeline.
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
      let links = ''
      if (survivingGroups.length > 0) {
        const lastGroup = survivingGroups[survivingGroups.length - 1]
        const firstGroup = survivingGroups[0]
        links = [
          buildLink('max_id', lastGroup.most_recent_notification_id),
          buildLink('min_id', firstGroup.most_recent_notification_id)
        ].join(', ')
      } else if (!exhausted && lastScannedId) {
        // No visible groups on this page but the source isn't exhausted (e.g. the
        // iteration cap was hit, or account_id filtered out the whole window): emit
        // only a next link from the last scanned row so the client keeps paging
        // toward matching/visible groups further down instead of stopping.
        links = buildLink('max_id', lastScannedId)
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: envelope,
        additionalHeaders: links ? [['Link', links] as [string, string]] : []
      })
    }
  )
)
