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
  // Present only for expand_accounts=partial_avatars: accounts that are not a
  // group's most recent sample, truncated to the avatar-rendering fields.
  partial_accounts?: PartialAccountWithAvatar[]
  statuses: Mastodon.Status[]
}

// Mastodon PartialAccountWithAvatar entity (4.3): the truncated account shape
// used by expand_accounts=partial_avatars.
export interface PartialAccountWithAvatar {
  id: string
  acct: string
  url: string
  avatar: string
  avatar_static: string
  locked: boolean
  bot: boolean
}

export const toPartialAccountWithAvatar = (
  account: Mastodon.Account
): PartialAccountWithAvatar => ({
  id: account.id,
  acct: account.acct,
  url: account.url,
  avatar: account.avatar,
  avatar_static: account.avatar_static,
  locked: account.locked,
  bot: account.bot
})

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
    const mastodonStatus = await getMastodonStatus(
      database,
      domainStatus,
      currentActorId
    )
    if (!mastodonStatus) continue
    if (filterRecords && filterRecords.length > 0) {
      const matches = applyFiltersToStatus(domainStatus, filterRecords)
      if (matches.some((m) => m.filter.filter_action === 'hide')) continue
      if (matches.length > 0) {
        // Attach warn-filter matches so clients can show the configured warning.
        results.push(
          mastodonStatus.reblog
            ? {
                ...mastodonStatus,
                reblog: { ...mastodonStatus.reblog, filtered: matches }
              }
            : { ...mastodonStatus, filtered: matches }
        )
        continue
      }
    }
    results.push(mastodonStatus)
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

  // Remove sample_account_ids that are absent from the resolved accounts (e.g.
  // deleted remote actors). Drop groups where every sampled actor was deleted so
  // clients don't receive an unrenderable group with no account object (mirrors
  // the v1 route which drops notifications whose source account cannot be loaded).
  const resolvedActorIds = new Set(accounts.map((a) => a.id))
  const notification_groups = survivingResults
    .map((r) => ({
      ...r.group,
      sample_account_ids: r.group.sample_account_ids.filter((id) =>
        resolvedActorIds.has(id)
      )
    }))
    .filter((g) => g.sample_account_ids.length > 0)

  // Prune top-level statuses to those still referenced by a surviving group so we
  // don't leak an orphaned status for a group that was dropped (e.g. all its
  // sampled actors were deleted).
  const referencedStatusIds = new Set(
    notification_groups
      .map((g) => g.status_id)
      .filter((id): id is string => Boolean(id))
  )
  const prunedStatuses = statuses.filter((s) => referencedStatusIds.has(s.id))

  return { notification_groups, accounts, statuses: prunedStatuses }
}

// Groups notifications for the grouped-notifications envelope. New follow rows
// carry a day-bucketed 'follow:<day>' key from creation; legacy follows without
// a stored groupKey stay individual (addressable via their notification id).
export const prepareGroupedNotifications = (
  notifications: Notification[],
  groupedTypes?: Set<NotificationType>
): GroupedNotification[] =>
  groupNotifications(notifications, true, groupedTypes)
