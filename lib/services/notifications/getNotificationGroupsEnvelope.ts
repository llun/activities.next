import { Database } from '@/lib/database/types'
import { applyFiltersToStatus } from '@/lib/services/filters/applyFilters'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import {
  MastodonNotificationGroup,
  getNotificationGroup
} from '@/lib/services/notifications/getNotificationGroup'
import {
  GroupedNotification,
  groupNotifications
} from '@/lib/services/notifications/groupNotifications'
import { Mastodon } from '@/lib/types/activitypub'
import {
  ActiveFilterRecord,
  Notification,
  NotificationType
} from '@/lib/types/database/operations'

// Mastodon's dehydrated grouped-notifications response: groups reference shared
// accounts and statuses by id, deduped into top-level arrays.
export interface NotificationGroupsEnvelope {
  notification_groups: MastodonNotificationGroup[]
  accounts: Mastodon.Account[]
  statuses: Mastodon.Status[]
}

const resolveAccounts = async (
  database: Database,
  actorIds: string[]
): Promise<Mastodon.Account[]> => {
  if (actorIds.length === 0) return []
  return database.getMastodonActorsFromIds({ ids: actorIds })
}

const resolveStatuses = async (
  database: Database,
  statusIds: string[],
  currentActorId?: string,
  filterRecords?: ActiveFilterRecord[]
): Promise<Mastodon.Status[]> => {
  if (statusIds.length === 0) return []
  const domainStatuses = await database.getStatusesByIds({
    statusIds,
    currentActorId,
    visibleToActorId: currentActorId,
    withReplies: false
  })
  const results: Mastodon.Status[] = []
  for (const domainStatus of domainStatuses) {
    if (filterRecords && filterRecords.length > 0) {
      const matches = applyFiltersToStatus(domainStatus, filterRecords)
      if (matches.some((m) => m.filter.filter_action === 'hide')) continue
    }
    const mastodonStatus = await getMastodonStatus(
      database,
      domainStatus,
      currentActorId
    )
    if (mastodonStatus) results.push(mastodonStatus)
  }
  return results
}

/**
 * Builds the Mastodon grouped-notifications envelope from already-grouped
 * notifications: one NotificationGroup per group, plus the deduped accounts and
 * statuses they reference.
 */
export const getNotificationGroupsEnvelope = async (
  database: Database,
  grouped: GroupedNotification[],
  currentActorId?: string,
  filterRecords?: ActiveFilterRecord[]
): Promise<NotificationGroupsEnvelope> => {
  const results = grouped.map(getNotificationGroup)

  // Resolve statuses first so we can filter groups by hide-filter results.
  const statusIds = Array.from(
    new Set(
      results
        .map((result) => result.statusId)
        .filter((statusId): statusId is string => Boolean(statusId))
    )
  )
  const statuses = await resolveStatuses(
    database,
    statusIds,
    currentActorId,
    filterRecords
  )

  // Drop groups whose referenced status was removed by a hide filter to avoid
  // dangling status_id references in the response.
  const resolvedStatusIds = new Set(statuses.map((s) => s.id))
  const survivingResults = results.filter(
    (r) => !r.group.status_id || resolvedStatusIds.has(r.group.status_id)
  )

  // Resolve accounts only for groups that survived the filter so we don't leak
  // actor data from hide-filtered notifications.
  const actorIds = Array.from(
    new Set(survivingResults.flatMap((result) => result.sampleActorIds))
  )
  const accounts = await resolveAccounts(database, actorIds)

  return {
    notification_groups: survivingResults.map((r) => r.group),
    accounts,
    statuses
  }
}

// Groups notifications and injects a synthetic 'follow' groupKey for follow
// notifications that have no DB-level groupKey. Returns the GroupedNotification
// array without resolving accounts/statuses — callers can slice before hydrating.
export const prepareGroupedNotifications = (
  notifications: Notification[],
  groupedTypes?: Set<NotificationType>
): GroupedNotification[] => {
  const canGroupFollows =
    !groupedTypes || groupedTypes.has(NotificationType.enum.follow)
  const prepared = notifications.map((n) =>
    n.type === NotificationType.enum.follow && !n.groupKey && canGroupFollows
      ? { ...n, groupKey: 'follow' }
      : n
  )
  return groupNotifications(prepared, true, groupedTypes)
}

// Convenience: group raw notifications then build the envelope.
export const buildNotificationGroupsEnvelope = (
  database: Database,
  notifications: Notification[],
  currentActorId?: string,
  groupedTypes?: Set<NotificationType>,
  filterRecords?: ActiveFilterRecord[]
): Promise<NotificationGroupsEnvelope> =>
  getNotificationGroupsEnvelope(
    database,
    prepareGroupedNotifications(notifications, groupedTypes),
    currentActorId,
    filterRecords
  )
